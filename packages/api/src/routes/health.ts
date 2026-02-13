import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { executionService } from '../services/execution.js';

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // Detailed health check including database and queue
  fastify.get('/health/detailed', {
    schema: {
      tags: ['health'],
      summary: 'Detailed health check including database and queue',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                database: { type: 'string' },
                queue: { type: 'string' },
              },
            },
            queue: {
              type: 'object',
              properties: {
                available: { type: 'boolean' },
                pendingJobs: { type: 'number' },
                activeJobs: { type: 'number' },
                completedJobs: { type: 'number' },
                failedJobs: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async () => {
    let dbStatus = 'unknown';

    // Check database connection
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    // Check queue status
    const queueStatus = await executionService.getQueueStatus();

    return {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        queue: queueStatus.available ? 'connected' : 'disconnected',
      },
      queue: queueStatus,
    };
  });

  // Platform stats for dashboard
  fastify.get('/stats', {
    schema: {
      tags: ['health'],
      summary: 'Platform-wide statistics for dashboard',
    },
  }, async () => {
    const [
      recordingCount,
      specCount,
      totalRuns,
      passedRuns,
      failedRuns,
      runningRuns,
      pendingRuns,
      projectCount,
      recentRuns,
    ] = await Promise.all([
      prisma.recording.count(),
      prisma.testSpec.count(),
      prisma.testRun.count(),
      prisma.testRun.count({ where: { status: 'PASSED' } }),
      prisma.testRun.count({ where: { status: 'FAILED' } }),
      prisma.testRun.count({ where: { status: 'RUNNING' } }),
      prisma.testRun.count({ where: { status: 'PENDING' } }),
      prisma.project.count(),
      prisma.testRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          testSpec: {
            select: {
              id: true,
              recording: { select: { name: true, dappUrl: true } },
            },
          },
        },
      }),
    ]);

    const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;

    return {
      projects: projectCount,
      recordings: recordingCount,
      specs: specCount,
      runs: {
        total: totalRuns,
        passed: passedRuns,
        failed: failedRuns,
        running: runningRuns,
        pending: pendingRuns,
        passRate,
      },
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        status: r.status,
        durationMs: r.durationMs,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt?.toISOString() || null,
        completedAt: r.completedAt?.toISOString() || null,
        recordingName: r.testSpec?.recording?.name || null,
        dappUrl: r.testSpec?.recording?.dappUrl || null,
        testSpecId: r.testSpecId,
      })),
    };
  });

  // Queue status endpoint
  fastify.get('/queue/status', {
    schema: {
      tags: ['health'],
      summary: 'Get execution queue status',
      response: {
        200: {
          type: 'object',
          properties: {
            available: { type: 'boolean' },
            pendingJobs: { type: 'number' },
            activeJobs: { type: 'number' },
            completedJobs: { type: 'number' },
            failedJobs: { type: 'number' },
          },
        },
      },
    },
  }, async () => {
    return executionService.getQueueStatus();
  });
}
