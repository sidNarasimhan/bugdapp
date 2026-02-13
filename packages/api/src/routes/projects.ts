import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { generateWallet } from '../utils/wallet.js';
import { executionService } from '../services/execution.js';

interface CreateProjectBody {
  name: string;
  homeUrl: string;
  description?: string;
  chainId?: number;
}

interface UpdateProjectBody {
  name?: string;
  homeUrl?: string;
  description?: string;
  chainId?: number;
  connectionSpecId?: string;
  dappContext?: string;
}

interface ProjectParams {
  id: string;
}

interface SuiteRunParams {
  id: string;
}

interface RunSuiteBody {
  headless?: boolean;
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
}

interface ListSuiteRunsQuery {
  limit?: number;
  offset?: number;
}

export async function projectsRoutes(fastify: FastifyInstance) {
  // Create a new project
  fastify.post<{ Body: CreateProjectBody }>('/', {
    schema: {
      tags: ['projects'],
      summary: 'Create a new project with auto-generated wallet',
      body: {
        type: 'object',
        required: ['name', 'homeUrl'],
        properties: {
          name: { type: 'string' },
          homeUrl: { type: 'string' },
          description: { type: 'string' },
          chainId: { type: 'number' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: CreateProjectBody }>, reply: FastifyReply) => {
    const { name, homeUrl, description, chainId } = request.body;

    const { seedPhrase, walletAddress } = generateWallet();

    const project = await prisma.project.create({
      data: {
        name,
        homeUrl,
        description: description || null,
        chainId: chainId || null,
        seedPhrase,
        walletAddress,
      },
    });

    // Return seedPhrase only on creation (shown once)
    return reply.status(201).send({
      id: project.id,
      name: project.name,
      homeUrl: project.homeUrl,
      description: project.description,
      walletAddress: project.walletAddress,
      seedPhrase: project.seedPhrase,
      chainId: project.chainId,
      createdAt: project.createdAt.toISOString(),
    });
  });

  // List all projects
  fastify.get('/', {
    schema: {
      tags: ['projects'],
      summary: 'List all projects',
    },
  }, async () => {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { recordings: true, suiteRuns: true },
        },
      },
    });

    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        homeUrl: p.homeUrl,
        description: p.description,
        walletAddress: p.walletAddress,
        chainId: p.chainId,
        recordingCount: p._count.recordings,
        suiteRunCount: p._count.suiteRuns,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  });

  // Get project by ID with recordings + specs
  fastify.get<{ Params: ProjectParams }>('/:id', {
    schema: {
      tags: ['projects'],
      summary: 'Get project with recordings and specs',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{ Params: ProjectParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        recordings: {
          orderBy: { createdAt: 'desc' },
          include: {
            testSpecs: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                clarifications: {
                  where: { status: 'PENDING' },
                  orderBy: { createdAt: 'asc' },
                },
                testRuns: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
                _count: {
                  select: { testRuns: true },
                },
              },
            },
          },
        },
        suiteRuns: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Never return seedPhrase in GET
    return {
      id: project.id,
      name: project.name,
      homeUrl: project.homeUrl,
      description: project.description,
      walletAddress: project.walletAddress,
      chainId: project.chainId,
      connectionSpecId: (project as { connectionSpecId?: string }).connectionSpecId || null,
      dappContext: (project as { dappContext?: string | null }).dappContext || null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      recordings: project.recordings.map((r) => {
        const spec = r.testSpecs[0];
        const lastRun = spec?.testRuns?.[0];
        return {
          id: r.id,
          name: r.name,
          dappUrl: r.dappUrl,
          stepCount: r.stepCount,
          chainId: r.chainId,
          walletName: r.walletName,
          createdAt: r.createdAt.toISOString(),
          latestSpec: spec ? {
            id: spec.id,
            status: spec.status,
            code: spec.code,
            patterns: spec.patterns,
            warnings: spec.warnings,
            pendingClarifications: spec.clarifications.map((c) => ({
              id: c.id,
              type: c.type,
              question: c.question,
              options: c.options,
              context: c.context,
            })),
            lastRun: lastRun ? {
              id: lastRun.id,
              status: lastRun.status,
              durationMs: lastRun.durationMs,
              error: lastRun.error,
              createdAt: lastRun.createdAt.toISOString(),
            } : null,
            runCount: spec._count.testRuns,
          } : null,
        };
      }),
      recentSuiteRuns: project.suiteRuns.map((sr) => ({
        id: sr.id,
        status: sr.status,
        totalTests: sr.totalTests,
        passedTests: sr.passedTests,
        failedTests: sr.failedTests,
        durationMs: sr.durationMs,
        createdAt: sr.createdAt.toISOString(),
        completedAt: sr.completedAt?.toISOString() || null,
      })),
    };
  });

  // Update project metadata
  fastify.put<{ Params: ProjectParams; Body: UpdateProjectBody }>('/:id', {
    schema: {
      tags: ['projects'],
      summary: 'Update project metadata',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          homeUrl: { type: 'string' },
          description: { type: 'string' },
          chainId: { type: 'number' },
          connectionSpecId: { type: 'string' },
          dappContext: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: ProjectParams; Body: UpdateProjectBody }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { name, homeUrl, description, chainId, connectionSpecId, dappContext } = request.body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(homeUrl !== undefined && { homeUrl }),
        ...(description !== undefined && { description }),
        ...(chainId !== undefined && { chainId }),
        ...(connectionSpecId !== undefined && { connectionSpecId }),
        ...(dappContext !== undefined && { dappContext }),
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      homeUrl: updated.homeUrl,
      description: updated.description,
      walletAddress: updated.walletAddress,
      chainId: updated.chainId,
      connectionSpecId: (updated as { connectionSpecId?: string }).connectionSpecId || null,
      dappContext: (updated as { dappContext?: string | null }).dappContext || null,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });

  // Delete a project (orphans recordings by nullifying projectId)
  fastify.delete<{ Params: ProjectParams }>('/:id', {
    schema: {
      tags: ['projects'],
      summary: 'Delete a project (recordings are kept but unlinked)',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{ Params: ProjectParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Unlink recordings before deleting project
    await prisma.recording.updateMany({
      where: { projectId: id },
      data: { projectId: null },
    });

    await prisma.project.delete({ where: { id } });

    return { success: true };
  });

  // Run all tests in a project as a suite
  fastify.post<{ Params: ProjectParams; Body: RunSuiteBody }>('/:id/run-suite', {
    schema: {
      tags: ['projects'],
      summary: 'Run all tests in a project sequentially',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          headless: { type: 'boolean', default: false },
          streamingMode: { type: 'string', enum: ['NONE', 'VNC', 'VIDEO'], default: 'NONE' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: ProjectParams; Body: RunSuiteBody }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { headless = false, streamingMode = 'NONE' } = request.body || {};

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        recordings: {
          include: {
            testSpecs: {
              where: { status: { not: 'DRAFT' } },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Collect all specs (one per recording)
    const specs = project.recordings
      .filter((r) => r.testSpecs.length > 0)
      .map((r) => ({
        id: r.testSpecs[0].id,
        code: r.testSpecs[0].code,
        name: r.name,
        // Use testType field for reliable classification, fallback to heuristic
        isConnectTest: (r as { testType?: string }).testType === 'connection'
          || r.testSpecs[0].code.includes('wallet.approve()'),
      }));

    if (specs.length === 0) {
      return reply.status(400).send({
        error: 'No test specs found. Generate tests for at least one recording first.',
      });
    }

    // Order: connect tests first
    specs.sort((a, b) => {
      if (a.isConnectTest && !b.isConnectTest) return -1;
      if (!a.isConnectTest && b.isConnectTest) return 1;
      return 0;
    });

    const specIds = specs.map((s) => s.id);

    // Create SuiteRun record
    const suiteRun = await prisma.suiteRun.create({
      data: {
        projectId: id,
        status: 'PENDING',
        specIds,
        totalTests: specs.length,
        headless,
        streamingMode: streamingMode as 'NONE' | 'VNC' | 'VIDEO',
      },
    });

    // Create individual TestRun records for each spec
    for (const spec of specs) {
      await prisma.testRun.create({
        data: {
          testSpecId: spec.id,
          status: 'PENDING',
          headless,
          streamingMode: streamingMode as 'NONE' | 'VNC' | 'VIDEO',
          suiteRunId: suiteRun.id,
        },
      });
    }

    // Queue the suite execution
    const queueResult = await executionService.queueSuiteRun(suiteRun.id);

    return reply.status(201).send({
      id: suiteRun.id,
      projectId: id,
      status: suiteRun.status,
      totalTests: suiteRun.totalTests,
      specIds,
      queued: queueResult.queued,
      message: queueResult.message,
      createdAt: suiteRun.createdAt.toISOString(),
    });
  });

  // List suite runs for a project
  fastify.get<{ Params: ProjectParams; Querystring: ListSuiteRunsQuery }>('/:id/suite-runs', {
    schema: {
      tags: ['projects'],
      summary: 'List suite runs for a project',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20 },
          offset: { type: 'number', default: 0 },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: ProjectParams; Querystring: ListSuiteRunsQuery }>) => {
    const { id } = request.params;
    const { limit = 20, offset = 0 } = request.query;

    const [suiteRuns, total] = await Promise.all([
      prisma.suiteRun.findMany({
        where: { projectId: id },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.suiteRun.count({ where: { projectId: id } }),
    ]);

    return {
      suiteRuns: suiteRuns.map((sr) => ({
        id: sr.id,
        status: sr.status,
        totalTests: sr.totalTests,
        passedTests: sr.passedTests,
        failedTests: sr.failedTests,
        durationMs: sr.durationMs,
        error: sr.error,
        createdAt: sr.createdAt.toISOString(),
        startedAt: sr.startedAt?.toISOString() || null,
        completedAt: sr.completedAt?.toISOString() || null,
      })),
      total,
      limit,
      offset,
    };
  });
}

// Separate route for suite run details (registered at /api/suite-runs)
export async function suiteRunsRoutes(fastify: FastifyInstance) {
  // Get suite run details with per-test results
  fastify.get<{ Params: SuiteRunParams }>('/:id', {
    schema: {
      tags: ['projects'],
      summary: 'Get suite run details with per-test results',
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request: FastifyRequest<{ Params: SuiteRunParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const suiteRun = await prisma.suiteRun.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true, walletAddress: true },
        },
        testRuns: {
          include: {
            testSpec: {
              select: {
                id: true,
                recordingId: true,
                recording: {
                  select: { name: true },
                },
              },
            },
            artifacts: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!suiteRun) {
      return reply.status(404).send({ error: 'Suite run not found' });
    }

    return {
      id: suiteRun.id,
      projectId: suiteRun.projectId,
      project: suiteRun.project,
      status: suiteRun.status,
      specIds: suiteRun.specIds,
      totalTests: suiteRun.totalTests,
      passedTests: suiteRun.passedTests,
      failedTests: suiteRun.failedTests,
      durationMs: suiteRun.durationMs,
      error: suiteRun.error,
      logs: suiteRun.logs,
      createdAt: suiteRun.createdAt.toISOString(),
      startedAt: suiteRun.startedAt?.toISOString() || null,
      completedAt: suiteRun.completedAt?.toISOString() || null,
      testRuns: suiteRun.testRuns.map((tr) => ({
        id: tr.id,
        testSpecId: tr.testSpecId,
        recordingName: tr.testSpec?.recording?.name || null,
        status: tr.status,
        passed: tr.passed,
        durationMs: tr.durationMs,
        error: tr.error,
        createdAt: tr.createdAt.toISOString(),
        startedAt: tr.startedAt?.toISOString() || null,
        completedAt: tr.completedAt?.toISOString() || null,
        artifacts: tr.artifacts.map((a) => ({
          id: a.id,
          type: a.type,
          name: a.name,
          storagePath: a.storagePath,
          createdAt: a.createdAt.toISOString(),
        })),
      })),
    };
  });
}
