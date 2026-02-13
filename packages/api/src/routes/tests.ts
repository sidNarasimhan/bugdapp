import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { translationService } from '../services/translation.js';

// Request/Response types
interface GenerateTestBody {
  recordingId: string;
}

interface GetTestParams {
  id: string;
}

interface UpdateTestBody {
  code?: string;
  status?: 'DRAFT' | 'NEEDS_REVIEW' | 'READY' | 'TESTED';
}

interface ListTestsQuery {
  limit?: number;
  offset?: number;
  recordingId?: string;
  status?: string;
}

export async function testsRoutes(fastify: FastifyInstance) {
  // Generate a test spec from a recording
  fastify.post<{ Body: GenerateTestBody }>('/generate', {
    schema: {
      tags: ['tests'],
      summary: 'Generate a Playwright/Synpress test spec from a recording',
      body: {
        type: 'object',
        required: ['recordingId'],
        properties: {
          recordingId: { type: 'string', description: 'ID of the recording to generate from' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            recordingId: { type: 'string' },
            code: { type: 'string' },
            status: { type: 'string' },
            patterns: { type: 'array' },
            warnings: { type: 'array', items: { type: 'string' } },
            clarifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  question: { type: 'string' },
                },
              },
            },
            createdAt: { type: 'string' },
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
  }, async (request: FastifyRequest<{ Body: GenerateTestBody }>, reply: FastifyReply) => {
    const { recordingId } = request.body;

    // Check recording exists
    const recording = await prisma.recording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      return reply.status(404).send({ error: 'Recording not found' });
    }

    // Generate test spec
    const result = await translationService.generateSpec(recording);

    if (!result.success) {
      return reply.status(400).send({
        error: 'Failed to generate test spec',
        details: result.errors?.join('; ') || 'Unknown error',
      });
    }

    // Save to database
    const testSpec = await prisma.testSpec.create({
      data: {
        recordingId,
        code: result.code!,
        status: result.clarifications && result.clarifications.length > 0 ? 'NEEDS_REVIEW' : 'READY',
        patterns: result.patterns || [],
        warnings: result.warnings || [],
      },
    });

    // Save clarifications if any
    let clarifications: Array<{ id: string; type: string; question: string }> = [];
    if (result.clarifications && result.clarifications.length > 0) {
      await prisma.clarification.createMany({
        data: result.clarifications.map((c) => ({
          testSpecId: testSpec.id,
          type: c.type.toUpperCase() as 'SELECTOR' | 'WAIT' | 'NETWORK' | 'ACTION' | 'GENERAL',
          question: c.question,
          context: c.context || null,
          stepIndex: c.stepIndex || null,
          options: c.options || [],
        })),
      });

      // Fetch created clarifications
      const savedClarifications = await prisma.clarification.findMany({
        where: { testSpecId: testSpec.id },
        select: { id: true, type: true, question: true },
      });
      clarifications = savedClarifications;
    }

    return reply.status(201).send({
      id: testSpec.id,
      recordingId: testSpec.recordingId,
      code: testSpec.code,
      status: testSpec.status,
      patterns: testSpec.patterns,
      warnings: testSpec.warnings,
      clarifications,
      createdAt: testSpec.createdAt.toISOString(),
    });
  });

  // Get a test spec by ID
  fastify.get<{ Params: GetTestParams }>('/:id', {
    schema: {
      tags: ['tests'],
      summary: 'Get a test spec by ID',
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
            recordingId: { type: 'string' },
            code: { type: 'string' },
            version: { type: 'number' },
            status: { type: 'string' },
            patterns: { type: 'array' },
            warnings: { type: 'array', items: { type: 'string' } },
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
  }, async (request: FastifyRequest<{ Params: GetTestParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const testSpec = await prisma.testSpec.findUnique({
      where: { id },
      include: {
        recording: {
          select: { name: true },
        },
      },
    });

    if (!testSpec) {
      return reply.status(404).send({ error: 'Test spec not found' });
    }

    return {
      id: testSpec.id,
      recordingId: testSpec.recordingId,
      recordingName: testSpec.recording?.name || null,
      code: testSpec.code,
      version: testSpec.version,
      status: testSpec.status,
      patterns: testSpec.patterns,
      warnings: testSpec.warnings,
      createdAt: testSpec.createdAt.toISOString(),
      updatedAt: testSpec.updatedAt.toISOString(),
    };
  });

  // Update a test spec (manual edits)
  fastify.put<{ Params: GetTestParams; Body: UpdateTestBody }>('/:id', {
    schema: {
      tags: ['tests'],
      summary: 'Update a test spec',
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
          code: { type: 'string', description: 'Updated test code' },
          status: {
            type: 'string',
            enum: ['DRAFT', 'NEEDS_REVIEW', 'READY', 'TESTED'],
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string' },
            version: { type: 'number' },
            status: { type: 'string' },
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
  }, async (request: FastifyRequest<{ Params: GetTestParams; Body: UpdateTestBody }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { code, status } = request.body;

    // Check exists
    const existing = await prisma.testSpec.findUnique({
      where: { id },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Test spec not found' });
    }

    // Update
    const updated = await prisma.testSpec.update({
      where: { id },
      data: {
        ...(code && { code, version: existing.version + 1 }),
        ...(status && { status }),
      },
    });

    return {
      id: updated.id,
      code: updated.code,
      version: updated.version,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });

  // List test specs
  fastify.get<{ Querystring: ListTestsQuery }>('/', {
    schema: {
      tags: ['tests'],
      summary: 'List all test specs',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20, maximum: 100 },
          offset: { type: 'number', default: 0 },
          recordingId: { type: 'string', description: 'Filter by recording ID' },
          status: { type: 'string', description: 'Filter by status' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            tests: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  recordingId: { type: 'string' },
                  code: { type: 'string' },
                  version: { type: 'number' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
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
  }, async (request: FastifyRequest<{ Querystring: ListTestsQuery }>) => {
    const { limit = 20, offset = 0, recordingId, status } = request.query;

    const where: Record<string, unknown> = {};
    if (recordingId) where.recordingId = recordingId;
    if (status) where.status = status;

    const [tests, total] = await Promise.all([
      prisma.testSpec.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          recordingId: true,
          code: true,
          version: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          recording: {
            select: { name: true },
          },
        },
      }),
      prisma.testSpec.count({ where }),
    ]);

    return {
      tests: tests.map((t) => ({
        ...t,
        recordingName: t.recording?.name || null,
        recording: undefined,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  });

  // Delete a test spec
  fastify.delete<{ Params: GetTestParams }>('/:id', {
    schema: {
      tags: ['tests'],
      summary: 'Delete a test spec',
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
  }, async (request: FastifyRequest<{ Params: GetTestParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      await prisma.testSpec.delete({
        where: { id },
      });
      return { success: true };
    } catch {
      return reply.status(404).send({ error: 'Test spec not found' });
    }
  });

  // Delete ALL test specs
  fastify.delete('/all/specs', {
    schema: {
      tags: ['tests'],
      summary: 'Delete all test specs and associated runs',
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
      const result = await prisma.testSpec.deleteMany({});
      return reply.send({
        deleted: result.count,
        message: `Deleted ${result.count} test specs and all associated runs`,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to delete all test specs');
      return reply.status(500).send({ error: 'Failed to delete test specs' });
    }
  });
}
