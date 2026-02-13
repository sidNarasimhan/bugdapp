import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { RecordingSchema, analyzeRecording } from '@web3-test/translator';
import { apiKeyService } from '../services/apikeys.js';

import { translationService } from '../services/translation.js';

// Request/Response types
interface UploadRecordingBody {
  name?: string;
  jsonData: unknown;
  autoGenerate?: boolean; // If true, automatically generate test spec after upload
  projectId?: string;     // Optional project association
}

interface GetRecordingParams {
  id: string;
}

interface ListRecordingsQuery {
  limit?: number;
  offset?: number;
  dappUrl?: string;
  projectId?: string;
}

interface UpdateRecordingBody {
  name?: string;
  steps?: unknown[];
  autoRegenerate?: boolean; // If true, regenerate test spec after updating steps
  projectId?: string | null;
}


export async function recordingsRoutes(fastify: FastifyInstance) {
  // Helper to validate API key from header
  async function validateApiKeyHeader(request: FastifyRequest): Promise<{
    valid: boolean;
    keyId?: string;
    error?: string;
  }> {
    const authHeader = request.headers['x-api-key'] || request.headers['authorization'];

    if (!authHeader) {
      return { valid: true }; // No auth required for now (allow anonymous uploads)
    }

    // Support both "Bearer token" and raw token formats
    const key = typeof authHeader === 'string'
      ? authHeader.replace(/^Bearer\s+/i, '')
      : authHeader[0]?.replace(/^Bearer\s+/i, '');

    if (!key) {
      return { valid: true };
    }

    return apiKeyService.validateKey(key);
  }

  // Upload a new recording
  fastify.post<{ Body: UploadRecordingBody }>('/', {
    schema: {
      tags: ['recordings'],
      summary: 'Upload a JSON recording',
      body: {
        type: 'object',
        required: ['jsonData'],
        properties: {
          name: { type: 'string', description: 'Optional name for the recording' },
          jsonData: { type: 'object', description: 'The recording JSON data' },
          autoGenerate: { type: 'boolean', description: 'Auto-generate test spec after upload', default: false },
          projectId: { type: 'string', description: 'Optional project ID to associate with' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            dappUrl: { type: 'string' },
            stepCount: { type: 'number' },
            chainId: { type: 'number', nullable: true },
            walletName: { type: 'string', nullable: true },
            createdAt: { type: 'string' },
            testSpec: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                hasCode: { type: 'boolean' },
              },
            },
            generationError: { type: 'string', nullable: true },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: UploadRecordingBody }>, reply: FastifyReply) => {
    // Optionally validate API key
    const auth = await validateApiKeyHeader(request);
    if (!auth.valid) {
      return reply.status(401).send({ error: auth.error || 'Invalid API key' });
    }

    const { name, jsonData, autoGenerate = false, projectId } = request.body;

    // Validate recording format
    const parseResult = RecordingSchema.safeParse(jsonData);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid recording format',
        details: parseResult.error.message,
      });
    }

    const recording = parseResult.data;

    // Analyze the recording to extract metadata
    const analysis = analyzeRecording(recording);

    // Create the recording in database
    const created = await prisma.recording.create({
      data: {
        name: name || recording.name,
        dappUrl: recording.startUrl,
        jsonData: jsonData as object,
        metadata: recording.metadata as object || null,
        chainId: analysis.detectedChainId || null,
        walletName: analysis.detectedWallet || null,
        stepCount: recording.steps.length,
        projectId: projectId || null,
      },
    });

    // Auto-generate test spec if requested
    let testSpec: { id: string; status: string; hasCode: boolean } | null = null;
    let generationError: string | null = null;

    if (autoGenerate) {
      try {
        // Fetch project's dappContext if available
        let dappContext: string | undefined;
        if (projectId) {
          const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { dappContext: true },
          });
          dappContext = (project as { dappContext?: string | null })?.dappContext || undefined;
        }

        const result = await translationService.generateSpec(created, { dappContext });

        if (result.success && result.code) {
          // Update recording testType from analysis
          if (result.testType) {
            await prisma.recording.update({
              where: { id: created.id },
              data: { testType: result.testType },
            });
          }

          const spec = await prisma.testSpec.create({
            data: {
              recordingId: created.id,
              code: result.code,
              status: result.clarifications && result.clarifications.length > 0 ? 'NEEDS_REVIEW' : 'READY',
              patterns: result.patterns || [],
              warnings: result.warnings || [],
            },
          });
          testSpec = { id: spec.id, status: spec.status, hasCode: true };
        } else {
          generationError = result.errors?.join('; ') || 'Generation failed';
        }
      } catch (error) {
        generationError = error instanceof Error ? error.message : 'Generation failed';
      }
    }

    return reply.status(201).send({
      id: created.id,
      name: created.name,
      dappUrl: created.dappUrl,
      stepCount: created.stepCount,
      chainId: created.chainId,
      walletName: created.walletName,
      createdAt: created.createdAt.toISOString(),
      testSpec,
      generationError,
    });
  });

  // Get a recording by ID
  fastify.get<{ Params: GetRecordingParams }>('/:id', {
    schema: {
      tags: ['recordings'],
      summary: 'Get a recording by ID',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            dappUrl: { type: 'string' },
            jsonData: { type: 'object', additionalProperties: true },
            metadata: { type: 'object', nullable: true, additionalProperties: true },
            chainId: { type: 'number', nullable: true },
            walletName: { type: 'string', nullable: true },
            stepCount: { type: 'number' },
            testType: { type: 'string', nullable: true },
            projectId: { type: 'string', nullable: true },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRecordingParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const recording = await prisma.recording.findUnique({
      where: { id },
    });

    if (!recording) {
      return reply.status(404).send({ error: 'Recording not found' });
    }

    return {
      id: recording.id,
      name: recording.name,
      dappUrl: recording.dappUrl,
      jsonData: recording.jsonData,
      metadata: recording.metadata,
      chainId: recording.chainId,
      walletName: recording.walletName,
      stepCount: recording.stepCount,
      testType: recording.testType,
      projectId: recording.projectId,
      createdAt: recording.createdAt.toISOString(),
      updatedAt: recording.updatedAt.toISOString(),
    };
  });

  // List recordings
  fastify.get<{ Querystring: ListRecordingsQuery }>('/', {
    schema: {
      tags: ['recordings'],
      summary: 'List all recordings',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20, maximum: 100 },
          offset: { type: 'number', default: 0 },
          dappUrl: { type: 'string', description: 'Filter by dApp URL' },
          projectId: { type: 'string', description: 'Filter by project ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            recordings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  dappUrl: { type: 'string' },
                  stepCount: { type: 'number' },
                  chainId: { type: 'number', nullable: true },
                  walletName: { type: 'string', nullable: true },
                  createdAt: { type: 'string' },
                },
              },
            },
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: ListRecordingsQuery }>) => {
    const { limit = 20, offset = 0, dappUrl, projectId } = request.query;

    const where: Record<string, unknown> = {};
    if (dappUrl) where.dappUrl = { contains: dappUrl };
    if (projectId) where.projectId = projectId;

    const [recordings, total] = await Promise.all([
      prisma.recording.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          dappUrl: true,
          stepCount: true,
          chainId: true,
          walletName: true,
          createdAt: true,
        },
      }),
      prisma.recording.count({ where }),
    ]);

    return {
      recordings: recordings.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  });

  // Delete a recording
  fastify.delete<{ Params: GetRecordingParams }>('/:id', {
    schema: {
      tags: ['recordings'],
      summary: 'Delete a recording',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRecordingParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      await prisma.recording.delete({
        where: { id },
      });
      return { success: true };
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to delete recording');
      return reply.status(404).send({ error: 'Recording not found or could not be deleted' });
    }
  });

  // Delete ALL recordings
  fastify.delete('/all/recordings', {
    schema: {
      tags: ['recordings'],
      summary: 'Delete all recordings and associated data',
      response: {
        200: {
          type: 'object',
          properties: {
            deleted: { type: 'number' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Delete all recordings (cascades to TestSpecs, TestRuns, Artifacts)
      const result = await prisma.recording.deleteMany({});
      return reply.send({
        deleted: result.count,
        message: `Deleted ${result.count} recordings and all associated data`,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to delete all recordings');
      return reply.status(500).send({ error: 'Failed to delete recordings' });
    }
  });

  // Update a recording (name, steps, etc.)
  fastify.put<{ Params: GetRecordingParams; Body: UpdateRecordingBody }>('/:id', {
    schema: {
      tags: ['recordings'],
      summary: 'Update a recording (name, steps, etc.)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'New name for the recording' },
          steps: { type: 'array', description: 'Updated steps array' },
          autoRegenerate: { type: 'boolean', description: 'Auto-regenerate test spec after updating steps', default: false },
          projectId: { type: ['string', 'null'], description: 'Project ID to associate (null to unlink)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            dappUrl: { type: 'string' },
            stepCount: { type: 'number' },
            chainId: { type: 'number', nullable: true },
            walletName: { type: 'string', nullable: true },
            updatedAt: { type: 'string' },
            testSpec: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                hasCode: { type: 'boolean' },
              },
            },
            generationError: { type: 'string', nullable: true },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRecordingParams; Body: UpdateRecordingBody }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { name, steps, autoRegenerate = false, projectId } = request.body;

    // Check recording exists
    const existing = await prisma.recording.findUnique({
      where: { id },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Recording not found' });
    }

    // Build update data
    const existingJsonData = existing.jsonData as { steps?: unknown[]; [key: string]: unknown };
    let updatedJsonData = existingJsonData;
    let stepCount = existing.stepCount;

    if (steps !== undefined) {
      updatedJsonData = {
        ...existingJsonData,
        steps,
      };
      stepCount = steps.length;
    }

    // Re-analyze if steps changed
    let chainId = existing.chainId;
    let walletName = existing.walletName;

    if (steps !== undefined) {
      const parseResult = RecordingSchema.safeParse(updatedJsonData);
      if (parseResult.success) {
        const analysis = analyzeRecording(parseResult.data);
        chainId = analysis.detectedChainId || null;
        walletName = analysis.detectedWallet || null;
      }
    }

    // Update the recording
    const updated = await prisma.recording.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(steps !== undefined && {
          jsonData: updatedJsonData as unknown as Prisma.InputJsonValue,
          stepCount
        }),
        ...(projectId !== undefined && { projectId }),
        chainId,
        walletName,
      },
    });

    // Auto-regenerate test spec if requested and steps were changed
    let testSpec: { id: string; status: string; hasCode: boolean } | null = null;
    let generationError: string | null = null;

    if (autoRegenerate && steps !== undefined) {
      try {
        const result = await translationService.generateSpec(updated);

        if (result.success && result.code) {
          // Delete existing specs and create new one
          await prisma.testSpec.deleteMany({
            where: { recordingId: id },
          });

          const spec = await prisma.testSpec.create({
            data: {
              recordingId: id,
              code: result.code,
              status: result.clarifications && result.clarifications.length > 0 ? 'NEEDS_REVIEW' : 'READY',
              patterns: result.patterns || [],
              warnings: result.warnings || [],
            },
          });
          testSpec = { id: spec.id, status: spec.status, hasCode: true };
        } else {
          generationError = result.errors?.join('; ') || 'Generation failed';
        }
      } catch (error) {
        generationError = error instanceof Error ? error.message : 'Generation failed';
      }
    }

    return {
      id: updated.id,
      name: updated.name,
      dappUrl: updated.dappUrl,
      stepCount: updated.stepCount,
      chainId: updated.chainId,
      walletName: updated.walletName,
      updatedAt: updated.updatedAt.toISOString(),
      testSpec,
      generationError,
    };
  });

  // Regenerate test spec for a recording
  fastify.post<{ Params: GetRecordingParams }>('/:id/regenerate', {
    schema: {
      tags: ['recordings'],
      summary: 'Regenerate the test spec for a recording',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            hasCode: { type: 'boolean' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRecordingParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const recording = await prisma.recording.findUnique({
      where: { id },
    });

    if (!recording) {
      return reply.status(404).send({ error: 'Recording not found' });
    }

    try {
      const result = await translationService.generateSpec(recording);

      if (!result.success || !result.code) {
        return reply.status(400).send({
          error: 'Failed to generate test spec',
          details: result.errors?.join('; ') || 'Unknown error',
        });
      }

      // Update recording testType from analysis
      if (result.testType) {
        await prisma.recording.update({
          where: { id },
          data: { testType: result.testType },
        });
      }

      // Check if any existing spec is referenced as a project's connectionSpecId
      const existingSpecs = await prisma.testSpec.findMany({
        where: { recordingId: id },
        select: { id: true },
      });
      const existingSpecIds = existingSpecs.map(s => s.id);

      // Delete existing specs and create new one
      await prisma.testSpec.deleteMany({
        where: { recordingId: id },
      });

      const spec = await prisma.testSpec.create({
        data: {
          recordingId: id,
          code: result.code,
          status: result.clarifications && result.clarifications.length > 0 ? 'NEEDS_REVIEW' : 'READY',
          patterns: result.patterns || [],
          warnings: result.warnings || [],
        },
      });

      // If any deleted spec was a project's connectionSpecId, update to new spec
      if (existingSpecIds.length > 0) {
        await prisma.project.updateMany({
          where: { connectionSpecId: { in: existingSpecIds } },
          data: { connectionSpecId: spec.id },
        });
      }

      return {
        id: spec.id,
        status: spec.status,
        hasCode: true,
        warnings: result.warnings || [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      return reply.status(400).send({
        error: 'Failed to generate test spec',
        details: message,
      });
    }
  });

  // Analyze a recording (returns patterns without saving)
  fastify.get<{ Params: GetRecordingParams }>('/:id/analyze', {
    schema: {
      tags: ['recordings'],
      summary: 'Analyze a recording and return detected patterns',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            patterns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  startIndex: { type: 'number' },
                  endIndex: { type: 'number' },
                  confidence: { type: 'number' },
                },
              },
            },
            chainId: { type: 'number', nullable: true },
            wallet: { type: 'string', nullable: true },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRecordingParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const recording = await prisma.recording.findUnique({
      where: { id },
    });

    if (!recording) {
      return reply.status(404).send({ error: 'Recording not found' });
    }

    // Parse and analyze
    const parseResult = RecordingSchema.safeParse(recording.jsonData);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Recording data is corrupted',
        details: parseResult.error.message,
      });
    }

    const analysis = analyzeRecording(parseResult.data);

    return {
      patterns: analysis.patterns.map((p) => ({
        type: p.type,
        startIndex: p.startIndex,
        endIndex: p.endIndex,
        confidence: p.confidence,
        metadata: p.metadata,
      })),
      chainId: analysis.detectedChainId,
      wallet: analysis.detectedWallet,
      warnings: analysis.warnings,
    };
  });
}
