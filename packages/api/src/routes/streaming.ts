import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WebSocket as WS } from 'ws';
import { prisma } from '../db.js';
import { containerService } from '../services/container.js';
import { executionService } from '../services/execution.js';

interface StartStreamParams {
  id: string;
}

interface StartStreamBody {
  testSpecId: string;
}

export async function streamingRoutes(fastify: FastifyInstance) {
  // Start a test run with live VNC streaming
  fastify.post<{ Body: StartStreamBody }>('/stream/start', {
    schema: {
      tags: ['streaming'],
      summary: 'Start a test run with live VNC streaming',
      body: {
        type: 'object',
        required: ['testSpecId'],
        properties: {
          testSpecId: { type: 'string', description: 'ID of the test spec to run' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            containerId: { type: 'string' },
            vncPort: { type: 'number' },
            websockifyPort: { type: 'number' },
            streamUrl: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        503: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: StartStreamBody }>, reply: FastifyReply) => {
    const { testSpecId } = request.body;

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

    // Check Docker availability
    const dockerAvailable = await containerService.isDockerAvailable();
    if (!dockerAvailable) {
      return reply.status(503).send({
        error: 'Live streaming not available. Docker is not configured.',
      });
    }

    // Create the run record with VNC streaming mode
    const run = await prisma.testRun.create({
      data: {
        testSpecId,
        status: 'PENDING',
        headless: false,
        streamingMode: 'VNC',
      },
    });

    // Spawn executor container with VNC
    const containerResult = await containerService.spawnExecutorContainer(run.id);

    if (!containerResult.success) {
      // Update run status to failed
      await prisma.testRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          error: containerResult.error,
        },
      });

      return reply.status(503).send({
        error: containerResult.error || 'Failed to start streaming container',
      });
    }

    // Queue the execution (container will pick it up)
    await executionService.queueRun(run.id, { streamingMode: 'VNC' });

    return reply.status(201).send({
      runId: run.id,
      containerId: containerResult.containerId,
      vncPort: containerResult.vncPort,
      websockifyPort: containerResult.websockifyPort,
      streamUrl: `/api/runs/${run.id}/vnc`,
    });
  });

  // WebSocket endpoint for VNC proxy
  // This proxies the WebSocket connection to the container's websockify server
  fastify.get<{ Params: StartStreamParams }>('/runs/:id/vnc', {
    websocket: true,
    schema: {
      tags: ['streaming'],
      summary: 'WebSocket proxy to VNC stream for a test run',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
  }, async (socket, request) => {
    const { id } = request.params;

    // Get run info
    const run = await prisma.testRun.findUnique({
      where: { id },
    });

    if (!run) {
      socket.close(4404, 'Run not found');
      return;
    }

    if (!run.vncPort) {
      socket.close(4400, 'VNC streaming not available for this run');
      return;
    }

    if (run.streamingMode !== 'VNC') {
      socket.close(4400, 'This run is not configured for VNC streaming');
      return;
    }

    // Determine the VNC server host
    // In Docker, containers can reach each other by container name on the same network
    const vncHost = run.containerId
      ? `executor-${run.id}` // Container name
      : 'localhost';
    const vncPort = 6080; // websockify port inside container

    console.log(`[Streaming] Proxying VNC for run ${id} to ${vncHost}:${vncPort}`);

    try {
      // Connect to the container's websockify server
      const upstream = new WS(`ws://${vncHost}:${vncPort}`);

      upstream.on('open', () => {
        console.log(`[Streaming] Connected to VNC server for run ${id}`);
      });

      upstream.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        // Forward VNC data to client
        if (socket.readyState === 1) { // WebSocket.OPEN
          socket.send(data);
        }
      });

      upstream.on('close', () => {
        console.log(`[Streaming] VNC upstream closed for run ${id}`);
        if (socket.readyState === 1) {
          socket.close(1000, 'VNC server disconnected');
        }
      });

      upstream.on('error', (error: Error) => {
        console.error(`[Streaming] VNC upstream error for run ${id}:`, error.message);
        if (socket.readyState === 1) {
          socket.close(4500, 'VNC server error');
        }
      });

      // Forward client messages to VNC server
      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        if (upstream.readyState === 1) {
          upstream.send(data);
        }
      });

      socket.on('close', () => {
        console.log(`[Streaming] Client disconnected from run ${id}`);
        upstream.close();
      });

      socket.on('error', (error: Error) => {
        console.error(`[Streaming] Client error for run ${id}:`, error);
        upstream.close();
      });
    } catch (error) {
      console.error(`[Streaming] Failed to connect to VNC for run ${id}:`, error);
      socket.close(4500, 'Failed to connect to VNC server');
    }
  });

  // Stop a streaming run
  fastify.post<{ Params: StartStreamParams }>('/runs/:id/stop', {
    schema: {
      tags: ['streaming'],
      summary: 'Stop a streaming test run and its container',
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
            success: { type: 'boolean' },
            message: { type: 'string' },
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
  }, async (request: FastifyRequest<{ Params: StartStreamParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const run = await prisma.testRun.findUnique({
      where: { id },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    // Stop container if exists
    if (run.containerId) {
      await containerService.stopContainer(run.containerId);
    }

    // Cancel job in queue
    await executionService.cancelRun(id);

    // Update run status
    await prisma.testRun.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    return {
      success: true,
      message: 'Run stopped and container removed',
    };
  });

  // Get container pool status
  fastify.get('/containers/status', {
    schema: {
      tags: ['streaming'],
      summary: 'Get status of all executor containers',
      response: {
        200: {
          type: 'object',
          properties: {
            dockerAvailable: { type: 'boolean' },
            containers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  runId: { type: 'string' },
                  status: { type: 'string' },
                  created: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const dockerAvailable = await containerService.isDockerAvailable();
    const containers = await containerService.listExecutorContainers();

    return {
      dockerAvailable,
      containers,
    };
  });
}
