import { Worker, Job, Queue } from 'bullmq';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { createRunner, type RunResult, type SuiteRunResult } from './runner.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// Lazy-loaded Prisma client (initialized when first needed)
let prisma: PrismaClientType | null = null;

async function getPrisma(): Promise<PrismaClientType> {
  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }
  return prisma;
}

// Redis connection options
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
};

// Queue name for test runs
const QUEUE_NAME = 'test-runs';

// Artifact storage path
const ARTIFACTS_BASE_PATH = process.env.ARTIFACTS_PATH || './artifacts';

// MinIO/S3 configuration
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'artifacts';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';

// dappwright test directory (with fallback to legacy SYNPRESS_TEST_DIR)
const DAPPWRIGHT_TEST_DIR = process.env.DAPPWRIGHT_TEST_DIR || process.env.SYNPRESS_TEST_DIR || join(process.cwd(), '..', '..', 'dappwright-test');

interface TestRunJobData {
  runId: string;
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
}

interface SuiteRunJobData {
  runId: string; // suiteRunId
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
}

interface SelfHealJobData {
  runId: string; // failed run ID to heal
}

interface AgentRunJobData {
  runId: string;
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
}

// S3 client for MinIO
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: `${MINIO_USE_SSL ? 'https' : 'http'}://${MINIO_ENDPOINT}:${MINIO_PORT}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: MINIO_ACCESS_KEY,
        secretAccessKey: MINIO_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

/**
 * Upload a file to MinIO
 */
async function uploadToMinio(localPath: string, runId: string, artifactType: string): Promise<string | null> {
  if (!existsSync(localPath)) {
    console.warn(`[Worker] File not found for upload: ${localPath}`);
    return null;
  }

  try {
    const fileName = basename(localPath);
    const key = `runs/${runId}/${artifactType}/${fileName}`;
    const client = getS3Client();

    await client.send(new PutObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
      Body: readFileSync(localPath),
      ContentType: getMimeType(fileName),
    }));

    console.log(`[Worker] Uploaded ${fileName} to ${MINIO_BUCKET}/${key}`);
    return `${MINIO_BUCKET}/${key}`;
  } catch (error) {
    console.error(`[Worker] Failed to upload ${localPath}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webm: 'video/webm',
    mp4: 'video/mp4',
    json: 'application/json',
    txt: 'text/plain',
    log: 'text/plain',
    zip: 'application/zip',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Process a test run job
 */
async function processTestRun(job: Job<TestRunJobData>): Promise<void> {
  const { runId, streamingMode = 'NONE' } = job.data;
  const db = await getPrisma();

  console.log(`[Worker] Processing run: ${runId} (streaming: ${streamingMode})`);

  // Get the run and its spec, traversing to recording → project for seedPhrase
  const run = await db.testRun.findUnique({
    where: { id: runId },
    include: {
      testSpec: {
        include: {
          recording: {
            include: {
              project: { select: { seedPhrase: true } },
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (!run.testSpec) {
    throw new Error(`Test spec not found for run: ${runId}`);
  }

  // Get seed phrase from project (if recording is associated with a project)
  const seedPhrase = run.testSpec.recording?.project?.seedPhrase;

  // Update status to running
  await db.testRun.update({
    where: { id: runId },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  // Update job progress
  await job.updateProgress(10);

  // Create runner - use dappwright-test infrastructure
  const artifactsDir = join(ARTIFACTS_BASE_PATH, runId);
  mkdirSync(artifactsDir, { recursive: true });

  // Determine headless based on streaming mode
  const isHeadless = streamingMode === 'NONE' && run.headless;

  const runner = createRunner({
    headless: isHeadless,
    outputDir: artifactsDir,
    keepArtifacts: true,
    debug: process.env.DEBUG === 'true',
    testDir: DAPPWRIGHT_TEST_DIR,
  });

  let result: RunResult;

  try {
    await job.updateProgress(20);

    // Check if this is a flow test that needs auto-connection
    const recording = run.testSpec.recording;
    const testType = recording ? (recording as { testType?: string }).testType : null;
    const projectId = recording?.projectId;

    if (testType === 'flow' && projectId && seedPhrase) {
      // Look up the project's connection spec
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { connectionSpecId: true },
      });

      const connectionSpecId = (project as { connectionSpecId?: string | null })?.connectionSpecId;

      if (connectionSpecId) {
        const connectionSpec = await db.testSpec.findUnique({
          where: { id: connectionSpecId },
          select: { code: true },
        });

        if (connectionSpec) {
          console.log(`[Worker] Flow test: using connection spec ${connectionSpecId}`);
          result = await runner.runWithConnection(connectionSpec.code, run.testSpec.code, seedPhrase);
        } else {
          // Connection spec not found, fall back to running as-is
          console.warn(`[Worker] Connection spec ${connectionSpecId} not found, running flow test as-is`);
          result = await runner.run(run.testSpec.code, undefined, seedPhrase);
        }
      } else {
        // No connection spec set for project, run as-is (translator should have added connection steps)
        result = await runner.run(run.testSpec.code, undefined, seedPhrase);
      }
    } else {
      // Connection test or no project association — run normally
      result = await runner.run(run.testSpec.code, undefined, seedPhrase);
    }

    await job.updateProgress(80);

    // Save logs locally
    const logsPath = join(artifactsDir, 'output.log');
    writeFileSync(logsPath, result.logs);

    // Upload logs to MinIO
    await uploadToMinio(logsPath, runId, 'logs');

    // Update run with results
    await db.testRun.update({
      where: { id: runId },
      data: {
        status: result.passed ? 'PASSED' : 'FAILED',
        passed: result.passed,
        completedAt: new Date(),
        durationMs: result.durationMs,
        error: result.error || null,
        logs: result.logs,
      },
    });

    // Upload and save artifacts
    for (const artifact of result.artifacts) {
      // Upload to MinIO
      const storagePath = await uploadToMinio(artifact.path, runId, artifact.type);

      // Save artifact record
      await db.artifact.create({
        data: {
          testRunId: runId,
          type: artifact.type.toUpperCase() as 'SCREENSHOT' | 'VIDEO' | 'TRACE' | 'LOG',
          name: artifact.name,
          storagePath: storagePath || artifact.path, // Fallback to local path if upload fails
          stepName: artifact.stepName || null,
        },
      });
    }

    // Update test spec status to TESTED
    await db.testSpec.update({
      where: { id: run.testSpec.id },
      data: { status: 'TESTED' },
    });

    // Auto-set connectionSpecId if this is a passing connection test
    if (result.passed && recording) {
      const recTestType = (recording as { testType?: string }).testType;
      if (recTestType === 'connection' && recording.projectId) {
        try {
          const project = await db.project.findUnique({
            where: { id: recording.projectId },
            select: { connectionSpecId: true },
          });
          // Only set if not already set (don't override a known-good connection spec)
          if (!(project as { connectionSpecId?: string | null })?.connectionSpecId) {
            await db.project.update({
              where: { id: recording.projectId },
              data: { connectionSpecId: run.testSpec.id },
            });
            console.log(`[Worker] Auto-set connectionSpecId for project ${recording.projectId} to ${run.testSpec.id}`);
          }
        } catch (err) {
          console.warn(`[Worker] Failed to auto-set connectionSpecId:`, err instanceof Error ? err.message : err);
        }
      }
    }

    await job.updateProgress(100);

    console.log(`[Worker] Run ${runId} completed: ${result.passed ? 'PASSED' : 'FAILED'} (${result.artifacts.length} artifacts)`);

    // HYBRID: if spec failed, launch agent to take over (replaces old self-heal loop)
    if (!result.passed && run.testSpec?.recording && process.env.ANTHROPIC_API_KEY) {
      console.log(`[Worker] Spec failed — launching agent fallback for run ${runId}`);
      try {
        const agentQueue = createQueue();
        // Create a new agent run linked to the same spec
        const agentRun = await db.testRun.create({
          data: {
            testSpecId: run.testSpec.id,
            status: 'PENDING',
            headless: run.headless,
            streamingMode: run.streamingMode,
            executionMode: 'AGENT',
            isAutoRetry: true,
          },
        });
        await agentQueue.add('execute-agent', {
          runId: agentRun.id,
          streamingMode: run.streamingMode,
        } as AgentRunJobData, {
          jobId: `agent-${agentRun.id}`,
          delay: 2000,
        });
        await agentQueue.close();
        console.log(`[Worker] Agent fallback queued: ${agentRun.id}`);
      } catch (agentErr) {
        console.error(`[Worker] Failed to queue agent fallback:`, agentErr instanceof Error ? agentErr.message : agentErr);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await db.testRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        passed: false,
        completedAt: new Date(),
        error: errorMessage,
      },
    });

    console.error(`[Worker] Run ${runId} failed:`, errorMessage);
    throw error;
  }
}

/**
 * Process a suite run job — runs all tests sequentially in a single browser context
 */
async function processSuiteRun(job: Job<SuiteRunJobData>): Promise<void> {
  const { runId: suiteRunId, streamingMode = 'NONE' } = job.data;
  const db = await getPrisma();

  console.log(`[Worker] Processing suite run: ${suiteRunId}`);

  const suiteRun = await db.suiteRun.findUnique({
    where: { id: suiteRunId },
    include: {
      project: true,
      testRuns: {
        include: { testSpec: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!suiteRun) {
    throw new Error(`Suite run not found: ${suiteRunId}`);
  }

  if (!suiteRun.project) {
    throw new Error(`Project not found for suite run: ${suiteRunId}`);
  }

  // Update suite status to running
  await db.suiteRun.update({
    where: { id: suiteRunId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  await job.updateProgress(10);

  // Build specs array — detect connect test, order connect-first
  const specs = suiteRun.testRuns
    .filter((tr) => tr.testSpec)
    .map((tr) => ({
      id: tr.testSpec!.id,
      code: tr.testSpec!.code,
      name: `test-${tr.testSpec!.id.slice(0, 8)}`,
      isConnectTest: tr.testSpec!.code.includes('wallet.approve()'),
      testRunId: tr.id,
    }));

  // Sort: connect tests first
  specs.sort((a, b) => {
    if (a.isConnectTest && !b.isConnectTest) return -1;
    if (!a.isConnectTest && b.isConnectTest) return 1;
    return 0;
  });

  const artifactsDir = join(ARTIFACTS_BASE_PATH, `suite-${suiteRunId}`);
  mkdirSync(artifactsDir, { recursive: true });

  const isHeadless = streamingMode === 'NONE' && suiteRun.headless;

  const runner = createRunner({
    headless: isHeadless,
    outputDir: artifactsDir,
    keepArtifacts: true,
    debug: process.env.DEBUG === 'true',
    testDir: DAPPWRIGHT_TEST_DIR,
  });

  try {
    await job.updateProgress(20);

    const result: SuiteRunResult = await runner.runSuite(
      specs,
      suiteRun.project.seedPhrase
    );

    await job.updateProgress(80);

    // Save logs
    const logsPath = join(artifactsDir, 'output.log');
    writeFileSync(logsPath, result.logs);
    await uploadToMinio(logsPath, `suite-${suiteRunId}`, 'logs');

    // Update individual TestRun records with per-test results
    for (const perTest of result.perTestResults) {
      const matchingSpec = specs.find((s) => s.id === perTest.specId);
      if (matchingSpec) {
        await db.testRun.update({
          where: { id: matchingSpec.testRunId },
          data: {
            status: perTest.passed ? 'PASSED' : 'FAILED',
            passed: perTest.passed,
            completedAt: new Date(),
            durationMs: perTest.durationMs || null,
            error: perTest.error || null,
          },
        });

        // Update spec status
        if (perTest.passed) {
          await db.testSpec.update({
            where: { id: perTest.specId },
            data: { status: 'TESTED' },
          });
        }
      }
    }

    // Upload artifacts
    for (const artifact of result.artifacts) {
      const storagePath = await uploadToMinio(artifact.path, `suite-${suiteRunId}`, artifact.type);
      await db.artifact.create({
        data: {
          testRunId: suiteRun.testRuns[0]?.id || suiteRunId,
          type: artifact.type.toUpperCase() as 'SCREENSHOT' | 'VIDEO' | 'TRACE' | 'LOG',
          name: artifact.name,
          storagePath: storagePath || artifact.path,
          stepName: artifact.stepName || null,
        },
      });
    }

    // Update suite run with aggregate results
    const passedCount = result.perTestResults.filter((r) => r.passed).length;
    const failedCount = result.perTestResults.filter((r) => !r.passed).length;
    const allPassed = failedCount === 0;

    await db.suiteRun.update({
      where: { id: suiteRunId },
      data: {
        status: allPassed ? 'PASSED' : 'FAILED',
        completedAt: new Date(),
        durationMs: result.durationMs,
        passedTests: passedCount,
        failedTests: failedCount,
        logs: result.logs,
        error: result.success ? null : (result.perTestResults.find((r) => !r.passed)?.error || 'Suite failed'),
      },
    });

    await job.updateProgress(100);

    console.log(`[Worker] Suite run ${suiteRunId} completed: ${passedCount}/${specs.length} passed`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Mark all pending test runs as failed
    for (const tr of suiteRun.testRuns) {
      await db.testRun.update({
        where: { id: tr.id },
        data: {
          status: 'FAILED',
          passed: false,
          completedAt: new Date(),
          error: errorMessage,
        },
      });
    }

    await db.suiteRun.update({
      where: { id: suiteRunId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: errorMessage,
      },
    });

    console.error(`[Worker] Suite run ${suiteRunId} failed:`, errorMessage);
    throw error;
  }
}

/**
 * Process a self-heal job — regenerate failed spec and queue a new run
 * Uses the API's self-heal service via dynamic import (shared DB/Redis)
 */
async function processSelfHeal(job: Job<SelfHealJobData>): Promise<void> {
  const { runId } = job.data;
  console.log(`[Worker] Processing self-heal for failed run: ${runId}`);

  try {
    // Dynamic import to avoid circular deps — self-heal service lives in the API package
    // but the executor has access to the same DB. We inline the logic here.
    const db = await getPrisma();

    const run = await db.testRun.findUnique({
      where: { id: runId },
      include: {
        testSpec: {
          include: {
            recording: {
              include: { project: true },
            },
          },
        },
      },
    });

    if (!run || run.status !== 'FAILED' || !run.testSpec) {
      console.log(`[Worker] Self-heal skipped for run ${runId}: not eligible`);
      return;
    }

    const spec = run.testSpec;
    const currentAttempt = (spec as { attempt?: number }).attempt || 1;
    const maxAttempts = (spec as { maxAttempts?: number }).maxAttempts || 3;

    if (currentAttempt >= maxAttempts) {
      console.log(`[Worker] Self-heal skipped: max attempts reached (${currentAttempt}/${maxAttempts})`);
      return;
    }

    // Import translator for regeneration (installed as file dep in Docker)
    const translatorModule = '@web3-test/translator';
    const { RecordingSchema, analyzeRecording, CodeGenerator } = await import(/* webpackIgnore: true */ translatorModule);

    const recording = spec.recording;
    if (!recording) {
      console.log(`[Worker] Self-heal skipped: no recording`);
      return;
    }

    const parseResult = RecordingSchema.safeParse(recording.jsonData);
    if (!parseResult.success) {
      console.log(`[Worker] Self-heal skipped: invalid recording`);
      return;
    }

    const analysis = analyzeRecording(parseResult.data);

    // Categorize failure
    const error = run.error || 'Test failed';
    const logs = run.logs || '';
    const combined = `${error}\n${logs}`.toLowerCase();
    let category = 'unknown';
    if (combined.includes('locator') || combined.includes('element not found') || combined.includes('strict mode')) category = 'selector';
    else if (combined.includes('timeout') || combined.includes('timed out')) category = 'timeout';
    else if (combined.includes('wallet') || combined.includes('metamask') || combined.includes('dappwright')) category = 'wallet';
    else if (combined.includes('expect(') || combined.includes('assertion')) category = 'assertion';
    else if (combined.includes('net::err') || combined.includes('navigation')) category = 'network';

    // Fetch screenshot artifacts as base64
    const screenshots: Array<{ base64: string; mediaType: 'image/png' | 'image/jpeg' }> = [];
    try {
      const artifacts = await db.artifact.findMany({
        where: { testRunId: runId, type: 'SCREENSHOT' },
        take: 5,
      });

      for (const artifact of artifacts) {
        try {
          const parts = artifact.storagePath.split('/');
          const bucket = parts[0];
          const key = parts.slice(1).join('/');

          const client = getS3Client();
          const response = await client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }));

          if (response.Body) {
            const bytes = await response.Body.transformToByteArray();
            const base64 = Buffer.from(bytes).toString('base64');
            screenshots.push({ base64, mediaType: 'image/png' });
          }
        } catch {
          // Skip failed screenshots
        }
      }
    } catch {
      // No screenshots available
    }

    // Collect fresh dApp screenshots if we have a URL and few/no failure screenshots
    if (screenshots.length < 2 && recording.dappUrl) {
      try {
        const { VisualContextCollector } = await import('./visual-context.js');
        const freshScreenshots = await VisualContextCollector.collectDappScreenshots(recording.dappUrl);
        for (const fresh of freshScreenshots) {
          screenshots.push({ base64: fresh.base64, mediaType: fresh.mediaType });
        }
        console.log(`[Worker] Self-heal: collected ${freshScreenshots.length} fresh dApp screenshots`);
      } catch (vizErr) {
        console.warn(`[Worker] Self-heal: visual context collection failed:`, vizErr instanceof Error ? vizErr.message : vizErr);
      }
    }

    const failureContext = {
      previousCode: spec.code,
      error,
      logs: logs.slice(-3000),
      diagnosis: `${category} failure: ${error.slice(0, 300)}`,
      category: category as 'selector' | 'timeout' | 'network' | 'wallet' | 'assertion' | 'unknown',
      screenshots,
      attempt: currentAttempt,
      maxAttempts,
    };

    // Regenerate using Sonnet for speed
    const regenerationModel = process.env.SELF_HEAL_MODEL || 'claude-sonnet-4-5-20250929';
    const generator = new CodeGenerator({
      model: regenerationModel,
      validateOutput: true,
    });

    console.log(`[Worker] Self-heal: regenerating spec (attempt ${currentAttempt + 1}/${maxAttempts}, category: ${category})`);
    const result = await generator.regenerate(analysis, failureContext);

    if (!result.success || !result.code) {
      console.error(`[Worker] Self-heal regeneration failed:`, result.errors?.join(', '));
      return;
    }

    // Save new spec
    const newSpec = await db.testSpec.create({
      data: {
        recordingId: recording.id,
        code: result.code,
        version: (spec.version || 1) + 1,
        status: 'READY',
        patterns: spec.patterns as object || undefined,
        warnings: result.warnings || [],
        attempt: currentAttempt + 1,
        maxAttempts: maxAttempts,
        parentSpecId: spec.id,
        failureContext: failureContext as unknown as object,
      },
    });

    // Create new test run
    const newRun = await db.testRun.create({
      data: {
        testSpecId: newSpec.id,
        status: 'PENDING',
        headless: run.headless,
        streamingMode: run.streamingMode,
        isAutoRetry: true,
      },
    });

    // Queue the new run
    const queue = createQueue();
    await queue.add('execute', {
      runId: newRun.id,
      streamingMode: run.streamingMode,
    }, {
      jobId: `run-${newRun.id}`,
    });
    await queue.close();

    console.log(`[Worker] Self-heal: created spec ${newSpec.id} and run ${newRun.id}`);
  } catch (error) {
    console.error(`[Worker] Self-heal failed for run ${runId}:`, error instanceof Error ? error.message : error);
  }
}

/**
 * Process an agent-mode test run — AI agent drives the browser in real-time
 */
async function processAgentRun(job: Job<AgentRunJobData>): Promise<void> {
  const { runId, streamingMode = 'NONE' } = job.data;
  const db = await getPrisma();

  console.log(`[Worker] Processing agent run: ${runId}`);

  // Get the run, spec, recording, and project
  const run = await db.testRun.findUnique({
    where: { id: runId },
    include: {
      testSpec: {
        include: {
          recording: {
            include: {
              project: { select: { seedPhrase: true, connectionSpecId: true, id: true, dappContext: true } },
            },
          },
        },
      },
    },
  });

  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.testSpec?.recording) throw new Error(`No recording found for run: ${runId}`);

  const recording = run.testSpec.recording;
  const seedPhrase = recording.project?.seedPhrase;
  if (!seedPhrase) throw new Error(`No seed phrase found for run: ${runId}`);

  // Parse recording JSON
  const translatorModule = '@web3-test/translator';
  const { RecordingSchema, analyzeRecording } = await import(/* webpackIgnore: true */ translatorModule);

  const parseResult = RecordingSchema.safeParse(recording.jsonData);
  if (!parseResult.success) throw new Error(`Invalid recording data: ${parseResult.error.message}`);

  const analysis = analyzeRecording(parseResult.data);

  // Update status to running
  await db.testRun.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  await job.updateProgress(10);

  // Import agent runner
  const { createAgentRunner } = await import('./agent/agent-runner.js');

  const artifactsDir = join(ARTIFACTS_BASE_PATH, runId);
  const isHeadless = streamingMode === 'NONE' && run.headless;

  const dappContext = (recording.project as { dappContext?: string | null })?.dappContext || undefined;

  const runner = createAgentRunner({
    artifactsDir,
    headless: isHeadless,
    debug: process.env.DEBUG === 'true',
    dappContext,
  });

  try {
    // Determine test type
    const testType = (recording as { testType?: string }).testType as 'connection' | 'flow' || analysis.testType;

    // For flow tests, load connection recording
    let connectionRecording: unknown = undefined;
    let connectionAnalysis: unknown = undefined;

    if (testType === 'flow' && recording.projectId) {
      const project = await db.project.findUnique({
        where: { id: recording.projectId },
        select: { connectionSpecId: true },
      });

      const connectionSpecId = (project as { connectionSpecId?: string | null })?.connectionSpecId;
      if (connectionSpecId) {
        // Get the connection spec's recording
        const connectionSpec = await db.testSpec.findUnique({
          where: { id: connectionSpecId },
          include: { recording: true },
        });

        if (connectionSpec?.recording) {
          const connParse = RecordingSchema.safeParse(connectionSpec.recording.jsonData);
          if (connParse.success) {
            connectionRecording = connParse.data;
            connectionAnalysis = analyzeRecording(connParse.data);
            console.log(`[Worker] Agent flow test: loaded connection recording from spec ${connectionSpecId}`);
          }
        }
      }
    }

    await job.updateProgress(20);

    // Run the agent
    const result = await runner.run(
      parseResult.data,
      analysis,
      testType,
      seedPhrase,
      connectionRecording as any,
      connectionAnalysis as any,
    );

    await job.updateProgress(80);

    // Upload artifacts to MinIO
    for (const artifact of result.artifacts) {
      const storagePath = await uploadToMinio(artifact.path, runId, artifact.type);
      await db.artifact.create({
        data: {
          testRunId: runId,
          type: artifact.type === 'screenshot' ? 'SCREENSHOT' : artifact.type === 'trace' ? 'TRACE' : 'LOG',
          name: artifact.name,
          storagePath: storagePath || artifact.path,
          stepName: artifact.stepId || null,
        },
      });
    }

    // Update run with results
    const logSummary = [
      `Agent run: ${result.passed ? 'PASSED' : 'FAILED'}`,
      `Steps: ${result.steps.length} (${result.steps.filter((s) => s.status === 'passed').length} passed)`,
      `API calls: ${result.usage.totalApiCalls}`,
      `Cost: ~$${result.usage.estimatedCostUsd.toFixed(3)}`,
      `Duration: ${result.durationMs}ms`,
      '',
      ...result.steps.map((s) => `[${s.status.toUpperCase()}] ${s.description}${s.error ? ` — ${s.error}` : ''}`),
    ].join('\n');

    // Build agentData for replay timeline
    const agentData = {
      steps: result.steps,
      usage: result.usage,
      model: process.env.AGENT_MODEL || 'claude-sonnet-4-5-20250929',
    };

    await db.testRun.update({
      where: { id: runId },
      data: {
        status: result.passed ? 'PASSED' : 'FAILED',
        passed: result.passed,
        completedAt: new Date(),
        durationMs: result.durationMs,
        error: result.error || null,
        logs: logSummary,
        agentData: agentData as any,
      },
    });

    // Auto-set connectionSpecId if this is a passing connection test
    if (result.passed && testType === 'connection' && recording.projectId) {
      try {
        const project = await db.project.findUnique({
          where: { id: recording.projectId },
          select: { connectionSpecId: true },
        });
        if (!(project as { connectionSpecId?: string | null })?.connectionSpecId) {
          await db.project.update({
            where: { id: recording.projectId },
            data: { connectionSpecId: run.testSpec.id },
          });
          console.log(`[Worker] Agent: auto-set connectionSpecId for project ${recording.projectId}`);
        }
      } catch (err) {
        console.warn(`[Worker] Agent: failed to auto-set connectionSpecId:`, err instanceof Error ? err.message : err);
      }
    }

    await job.updateProgress(100);
    console.log(`[Worker] Agent run ${runId} completed: ${result.passed ? 'PASSED' : 'FAILED'} (${result.usage.totalApiCalls} API calls, ~$${result.usage.estimatedCostUsd.toFixed(3)})`);

    // NO self-heal loop for agent mode — the agent adapts in real-time
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await db.testRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        passed: false,
        completedAt: new Date(),
        error: errorMessage,
      },
    });

    console.error(`[Worker] Agent run ${runId} failed:`, errorMessage);
    throw error;
  }
}

/**
 * Start the worker
 */
export async function startWorker(): Promise<Worker> {
  console.log('[Worker] Starting test run worker...');

  const worker = new Worker<TestRunJobData | SuiteRunJobData | SelfHealJobData | AgentRunJobData>(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'execute-agent') {
        return processAgentRun(job as Job<AgentRunJobData>);
      }
      if (job.name === 'execute-suite') {
        return processSuiteRun(job as Job<SuiteRunJobData>);
      }
      if (job.name === 'self-heal') {
        return processSelfHeal(job as Job<SelfHealJobData>);
      }
      return processTestRun(job as Job<TestRunJobData>);
    },
    {
      connection: redisConnection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || '1', 10),
      limiter: {
        max: 5,
        duration: 60000, // Max 5 jobs per minute
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Error:', err.message);
  });

  console.log('[Worker] Worker started, waiting for jobs...');

  return worker;
}

/**
 * Create a queue for adding jobs
 */
export function createQueue(): Queue<TestRunJobData> {
  return new Queue<TestRunJobData>(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: {
        count: 100,
      },
      removeOnFail: {
        count: 100,
      },
    },
  });
}

/**
 * Add a run to the queue
 */
export async function queueRun(runId: string): Promise<Job<TestRunJobData>> {
  const queue = createQueue();
  const job = await queue.add('execute', { runId });
  await queue.close();
  return job;
}

// Start worker if run directly
if (process.argv[1].endsWith('worker.js') || process.argv[1].endsWith('worker.ts')) {
  startWorker()
    .then(() => {
      console.log('[Worker] Worker is running');
    })
    .catch((err) => {
      console.error('[Worker] Failed to start:', err);
      process.exit(1);
    });
}
