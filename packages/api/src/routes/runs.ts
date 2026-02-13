import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { executionService } from '../services/execution.js';
import { selfHealService } from '../services/self-heal.js';
import { getReplayManifest, getFrameFromZip } from '../services/trace-parser.js';

// Request/Response types
interface CreateRunBody {
  testSpecId?: string;
  recordingId?: string;
  headless?: boolean;
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
  executionMode?: 'SPEC' | 'AGENT';
}

interface GetRunParams {
  id: string;
}

interface ListRunsQuery {
  limit?: number;
  offset?: number;
  testSpecId?: string;
  status?: string;
}

export async function runsRoutes(fastify: FastifyInstance) {
  // Start a new test run
  fastify.post<{ Body: CreateRunBody }>('/', {
    schema: {
      tags: ['runs'],
      summary: 'Start a new test execution',
      body: {
        type: 'object',
        properties: {
          testSpecId: { type: 'string', description: 'ID of the test spec to run (required for SPEC mode)' },
          recordingId: { type: 'string', description: 'ID of the recording to run (required for AGENT mode)' },
          headless: { type: 'boolean', default: false, description: 'Run in headless mode' },
          streamingMode: {
            type: 'string',
            enum: ['NONE', 'VNC', 'VIDEO'],
            default: 'NONE',
            description: 'Streaming mode: NONE (headless), VNC (live view), VIDEO (post-run recording)',
          },
          executionMode: {
            type: 'string',
            enum: ['SPEC', 'AGENT'],
            default: 'SPEC',
            description: 'Execution mode: SPEC (traditional spec runner) or AGENT (AI agent-driven)',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            testSpecId: { type: 'string' },
            status: { type: 'string' },
            headless: { type: 'boolean' },
            streamingMode: { type: 'string' },
            executionMode: { type: 'string' },
            queued: { type: 'boolean' },
            message: { type: 'string' },
            createdAt: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
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
  }, async (request: FastifyRequest<{ Body: CreateRunBody }>, reply: FastifyReply) => {
    const { testSpecId, recordingId, headless = false, streamingMode = 'NONE', executionMode = 'SPEC' } = request.body;

    // Derive headless from streamingMode if not explicitly set
    const isHeadless = streamingMode === 'NONE' ? headless : false;

    if (executionMode === 'AGENT') {
      // Agent mode: requires recordingId (or testSpecId to look up the recording)
      let resolvedRecordingId = recordingId;

      if (!resolvedRecordingId && testSpecId) {
        // Look up recording from spec
        const spec = await prisma.testSpec.findUnique({
          where: { id: testSpecId },
          select: { recordingId: true },
        });
        if (spec) resolvedRecordingId = spec.recordingId;
      }

      if (!resolvedRecordingId) {
        return reply.status(400).send({ error: 'Agent mode requires recordingId or testSpecId with associated recording' });
      }

      // Verify recording exists
      const recording = await prisma.recording.findUnique({
        where: { id: resolvedRecordingId },
      });
      if (!recording) {
        return reply.status(404).send({ error: 'Recording not found' });
      }

      // For agent mode, create a placeholder spec (or use existing)
      let specId = testSpecId;
      if (!specId) {
        // Find or create a placeholder spec for agent runs
        const existingSpec = await prisma.testSpec.findFirst({
          where: { recordingId: resolvedRecordingId, status: 'READY' },
          orderBy: { createdAt: 'desc' },
        });

        if (existingSpec) {
          specId = existingSpec.id;
        } else {
          const placeholderSpec = await prisma.testSpec.create({
            data: {
              recordingId: resolvedRecordingId,
              code: '// Agent-driven execution — no static spec',
              version: 1,
              status: 'READY',
            },
          });
          specId = placeholderSpec.id;
        }
      }

      // Create agent run
      const run = await prisma.testRun.create({
        data: {
          testSpecId: specId,
          status: 'PENDING',
          headless: isHeadless,
          streamingMode: streamingMode as 'NONE' | 'VNC' | 'VIDEO',
          executionMode: 'AGENT',
        },
      });

      const queueResult = await executionService.queueAgentRun(run.id, { streamingMode: streamingMode as 'NONE' | 'VNC' | 'VIDEO' });

      return reply.status(201).send({
        id: run.id,
        testSpecId: specId,
        status: run.status,
        headless: run.headless,
        streamingMode: run.streamingMode,
        executionMode: 'AGENT',
        queued: queueResult.queued,
        message: queueResult.message,
        createdAt: run.createdAt.toISOString(),
      });
    }

    // SPEC mode (original behavior)
    if (!testSpecId) {
      return reply.status(400).send({ error: 'testSpecId is required for SPEC execution mode' });
    }

    // Check test spec exists
    const testSpec = await prisma.testSpec.findUnique({
      where: { id: testSpecId },
    });

    if (!testSpec) {
      return reply.status(404).send({ error: 'Test spec not found' });
    }

    // Only block DRAFT specs (no code). Allow NEEDS_REVIEW, READY, and TESTED.
    if (testSpec.status === 'DRAFT') {
      return reply.status(400).send({
        error: `Test spec has no code (status: ${testSpec.status})`,
      });
    }

    // Create the run record
    const run = await prisma.testRun.create({
      data: {
        testSpecId,
        status: 'PENDING',
        headless: isHeadless,
        streamingMode: streamingMode as 'NONE' | 'VNC' | 'VIDEO',
        executionMode: 'SPEC',
      },
    });

    // Queue the execution (will be handled by BullMQ worker)
    const queueResult = await executionService.queueRun(run.id, { streamingMode: streamingMode as 'NONE' | 'VNC' | 'VIDEO' });

    return reply.status(201).send({
      id: run.id,
      testSpecId: run.testSpecId,
      status: run.status,
      headless: run.headless,
      streamingMode: run.streamingMode,
      executionMode: 'SPEC',
      queued: queueResult.queued,
      message: queueResult.message,
      createdAt: run.createdAt.toISOString(),
    });
  });

  // Get a run by ID
  fastify.get<{ Params: GetRunParams }>('/:id', {
    schema: {
      tags: ['runs'],
      summary: 'Get a test run by ID',
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
            testSpecId: { type: 'string' },
            status: { type: 'string' },
            startedAt: { type: 'string', nullable: true },
            completedAt: { type: 'string', nullable: true },
            durationMs: { type: 'number', nullable: true },
            passed: { type: 'boolean', nullable: true },
            error: { type: 'string', nullable: true },
            headless: { type: 'boolean' },
            executionMode: { type: 'string' },
            agentData: { type: 'object', nullable: true, additionalProperties: true },
            createdAt: { type: 'string' },
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
  }, async (request: FastifyRequest<{ Params: GetRunParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const run = await prisma.testRun.findUnique({
      where: { id },
      include: {
        testSpec: {
          select: {
            recording: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Test run not found' });
    }

    return {
      id: run.id,
      testSpecId: run.testSpecId,
      recordingName: run.testSpec?.recording?.name || null,
      status: run.status,
      startedAt: run.startedAt?.toISOString() || null,
      completedAt: run.completedAt?.toISOString() || null,
      durationMs: run.durationMs,
      passed: run.passed,
      error: run.error,
      headless: run.headless,
      executionMode: run.executionMode,
      agentData: (run as any).agentData || null,
      createdAt: run.createdAt.toISOString(),
    };
  });

  // List runs
  fastify.get<{ Querystring: ListRunsQuery }>('/', {
    schema: {
      tags: ['runs'],
      summary: 'List all test runs',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20, maximum: 100 },
          offset: { type: 'number', default: 0 },
          testSpecId: { type: 'string', description: 'Filter by test spec ID' },
          status: { type: 'string', description: 'Filter by status' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            runs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  testSpecId: { type: 'string' },
                  status: { type: 'string' },
                  passed: { type: 'boolean', nullable: true },
                  durationMs: { type: 'number', nullable: true },
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
  }, async (request: FastifyRequest<{ Querystring: ListRunsQuery }>) => {
    const { limit = 20, offset = 0, testSpecId, status } = request.query;

    const where: Record<string, unknown> = {};
    if (testSpecId) where.testSpecId = testSpecId;
    if (status) where.status = status;

    const [runs, total] = await Promise.all([
      prisma.testRun.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          testSpecId: true,
          status: true,
          passed: true,
          durationMs: true,
          headless: true,
          error: true,
          createdAt: true,
          testSpec: {
            select: {
              recording: {
                select: { name: true },
              },
            },
          },
        },
      }),
      prisma.testRun.count({ where }),
    ]);

    return {
      runs: runs.map((r) => ({
        ...r,
        recordingName: r.testSpec?.recording?.name || null,
        testSpec: undefined,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  });

  // Get artifacts for a run
  fastify.get<{ Params: GetRunParams }>('/:id/artifacts', {
    schema: {
      tags: ['runs'],
      summary: 'Get artifacts (screenshots, traces, etc.) for a test run',
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
            artifacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  name: { type: 'string' },
                  storagePath: { type: 'string' },
                  stepName: { type: 'string', nullable: true },
                  mimeType: { type: 'string', nullable: true },
                  sizeBytes: { type: 'number', nullable: true },
                  createdAt: { type: 'string' },
                },
              },
            },
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
  }, async (request: FastifyRequest<{ Params: GetRunParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check run exists
    const run = await prisma.testRun.findUnique({
      where: { id },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Test run not found' });
    }

    const artifacts = await prisma.artifact.findMany({
      where: { testRunId: id },
      orderBy: { createdAt: 'asc' },
    });

    return {
      artifacts: artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        storagePath: a.storagePath,
        stepName: a.stepName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });

  // Self-heal a failed run (manual trigger)
  fastify.post<{ Params: GetRunParams }>('/:id/self-heal', {
    schema: {
      tags: ['runs'],
      summary: 'Trigger self-healing regeneration for a failed test run',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRunParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const run = await prisma.testRun.findUnique({ where: { id } });
    if (!run) {
      return reply.status(404).send({ error: 'Test run not found' });
    }

    if (run.status !== 'FAILED') {
      return reply.status(400).send({ error: `Can only self-heal FAILED runs, current status: ${run.status}` });
    }

    const result = await selfHealService.healFailedRun(id);

    return reply.status(result.healed ? 201 : 200).send({
      regenerated: result.healed,
      newSpecId: result.newSpecId || null,
      newRunId: result.newRunId || null,
      reason: result.reason,
    });
  });

  // Cancel a run
  fastify.post<{ Params: GetRunParams }>('/:id/cancel', {
    schema: {
      tags: ['runs'],
      summary: 'Cancel a pending or running test',
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
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
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
  }, async (request: FastifyRequest<{ Params: GetRunParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const run = await prisma.testRun.findUnique({
      where: { id },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Test run not found' });
    }

    if (run.status !== 'PENDING' && run.status !== 'RUNNING') {
      return reply.status(400).send({
        error: `Cannot cancel run with status: ${run.status}`,
      });
    }

    // Update status
    const updated = await prisma.testRun.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    // Try to cancel the job in BullMQ (removes waiting/delayed jobs)
    try {
      await executionService.cancelRun(id);
    } catch (err) {
      // Non-fatal — DB status is already CANCELLED
      fastify.log.warn({ err, runId: id }, 'Failed to cancel BullMQ job');
    }

    return {
      id: updated.id,
      status: updated.status,
    };
  });

  // SSE stream for live updates (basic implementation)
  fastify.get<{ Params: GetRunParams }>('/:id/stream', {
    schema: {
      tags: ['runs'],
      summary: 'Stream live updates for a test run (Server-Sent Events)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRunParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check run exists
    const run = await prisma.testRun.findUnique({
      where: { id },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Test run not found' });
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial status
    reply.raw.write(`data: ${JSON.stringify({ type: 'status', status: run.status })}\n\n`);

    // Poll for updates (simple implementation)
    const interval = setInterval(async () => {
      const currentRun = await prisma.testRun.findUnique({
        where: { id },
      });

      if (currentRun) {
        reply.raw.write(`data: ${JSON.stringify({
          type: 'status',
          status: currentRun.status,
          passed: currentRun.passed,
          error: currentRun.error,
        })}\n\n`);

        // Stop polling if run is complete
        if (['PASSED', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(currentRun.status)) {
          clearInterval(interval);
          reply.raw.end();
        }
      }
    }, 2000);

    // Handle client disconnect
    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  // Delete ALL test runs
  fastify.delete('/all/runs', {
    schema: {
      tags: ['runs'],
      summary: 'Delete all test runs and associated artifacts',
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
      const result = await prisma.testRun.deleteMany({});
      return reply.send({
        deleted: result.count,
        message: `Deleted ${result.count} test runs and all associated artifacts`,
      });
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to delete all test runs');
      return reply.status(500).send({ error: 'Failed to delete test runs' });
    }
  });

  // --- Replay endpoints ---

  // Get replay manifest for a run (parsed from trace.zip)
  fastify.get<{ Params: GetRunParams }>('/:id/replay', {
    schema: {
      tags: ['runs'],
      summary: 'Get replay manifest from trace.zip for a test run',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRunParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Find the TRACE artifact for this run
    const traceArtifact = await prisma.artifact.findFirst({
      where: { testRunId: id, type: 'TRACE' },
    });

    if (!traceArtifact) {
      return reply.status(404).send({ error: 'No trace artifact found for this run' });
    }

    try {
      const manifest = await getReplayManifest(id, traceArtifact.storagePath);

      if (manifest.frameCount === 0) {
        return reply.status(404).send({ error: 'No screencast frames found in trace' });
      }

      return manifest;
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to parse trace for replay');
      return reply.status(500).send({ error: 'Failed to parse trace file' });
    }
  });

  // Serve individual frame JPEG from trace.zip
  fastify.get<{ Params: GetRunParams & { sha1: string } }>('/:id/replay/frames/:sha1', {
    schema: {
      tags: ['runs'],
      summary: 'Get a single screencast frame from the trace',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sha1: { type: 'string' },
        },
        required: ['id', 'sha1'],
      },
    },
  }, async (request: FastifyRequest<{ Params: GetRunParams & { sha1: string } }>, reply: FastifyReply) => {
    const { id, sha1 } = request.params;

    const traceArtifact = await prisma.artifact.findFirst({
      where: { testRunId: id, type: 'TRACE' },
    });

    if (!traceArtifact) {
      return reply.status(404).send({ error: 'No trace artifact found' });
    }

    try {
      const frameBuffer = await getFrameFromZip(id, traceArtifact.storagePath, sha1);

      if (!frameBuffer) {
        return reply.status(404).send({ error: 'Frame not found in trace' });
      }

      reply.header('Content-Type', 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=86400, immutable');
      reply.header('Content-Length', frameBuffer.length);
      return reply.send(frameBuffer);
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to extract frame from trace');
      return reply.status(500).send({ error: 'Failed to extract frame' });
    }
  });
}
