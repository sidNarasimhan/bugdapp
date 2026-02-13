import { prisma } from '../db.js';
import { executionService } from './execution.js';
import {
  RecordingSchema,
  analyzeRecording,
  CodeGenerator,
  type FailureContext,
  type FailureCategory,
} from '@web3-test/translator';

// Lazy-load S3 to avoid failing if @aws-sdk/client-s3 is not installed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let S3ClientClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GetObjectCommandClass: any = null;

async function loadS3() {
  if (!S3ClientClass) {
    // Dynamic import with variable to bypass TypeScript module resolution check
    const modName = '@aws-sdk/client-s3';
    const mod = await import(/* webpackIgnore: true */ modName);
    S3ClientClass = mod.S3Client;
    GetObjectCommandClass = mod.GetObjectCommand;
  }
}

// MinIO/S3 configuration (mirrors worker.ts)
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin123';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let s3Client: any = null;

async function getS3Client() {
  await loadS3();
  if (!s3Client) {
    s3Client = new S3ClientClass!({
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

export interface SelfHealResult {
  healed: boolean;
  newSpecId?: string;
  newRunId?: string;
  reason: string;
}

/**
 * Categorize a failure based on error message and logs
 */
function categorizeFailure(error: string, logs: string): FailureCategory {
  const combined = `${error}\n${logs}`.toLowerCase();

  if (
    combined.includes('locator.click') ||
    combined.includes('locator.fill') ||
    combined.includes('element not found') ||
    combined.includes('no element matches') ||
    combined.includes('strict mode violation') ||
    combined.includes('resolved to') && combined.includes('elements')
  ) {
    return 'selector';
  }

  if (
    combined.includes('timeout') ||
    combined.includes('waiting for') ||
    combined.includes('timed out')
  ) {
    return 'timeout';
  }

  if (
    combined.includes('wallet') ||
    combined.includes('metamask') ||
    combined.includes('dappwright') ||
    combined.includes('approve') ||
    combined.includes('sign')
  ) {
    return 'wallet';
  }

  if (
    combined.includes('expect(') ||
    combined.includes('assertion') ||
    combined.includes('tocontain') ||
    combined.includes('tobe')
  ) {
    return 'assertion';
  }

  if (
    combined.includes('net::err') ||
    combined.includes('navigation') ||
    combined.includes('page.goto')
  ) {
    return 'network';
  }

  return 'unknown';
}

/**
 * Generate a diagnosis string for the failure
 */
function diagnosisFromCategory(category: FailureCategory, error: string): string {
  switch (category) {
    case 'selector':
      return `Selector failure: The generated selector doesn't match the actual DOM element. Error: ${error.slice(0, 300)}`;
    case 'timeout':
      return `Timeout: An element or condition was not met within the expected time. The dApp may load slowly or the element may not exist. Error: ${error.slice(0, 300)}`;
    case 'wallet':
      return `Wallet interaction failure: MetaMask/dappwright method failed. This could be a timing issue or incorrect popup handling. Error: ${error.slice(0, 300)}`;
    case 'assertion':
      return `Assertion failure: The test's verification check failed. The expected state was not achieved. Error: ${error.slice(0, 300)}`;
    case 'network':
      return `Network/navigation error: The page failed to load or navigate. Error: ${error.slice(0, 300)}`;
    default:
      return `Unclassified failure. Error: ${error.slice(0, 300)}`;
  }
}

/**
 * Fetch screenshot artifacts from MinIO as base64
 */
async function fetchScreenshotArtifacts(
  runId: string
): Promise<Array<{ base64: string; mediaType: 'image/png' | 'image/jpeg' }>> {
  const screenshots: Array<{ base64: string; mediaType: 'image/png' | 'image/jpeg' }> = [];

  try {
    const artifacts = await prisma.artifact.findMany({
      where: { testRunId: runId, type: 'SCREENSHOT' },
      take: 5, // Limit to 5 screenshots
    });

    const client = await getS3Client();
    await loadS3();

    for (const artifact of artifacts) {
      try {
        // Parse bucket/key from storagePath
        const parts = artifact.storagePath.split('/');
        const bucket = parts[0];
        const key = parts.slice(1).join('/');

        const response = await client.send(new GetObjectCommandClass!({
          Bucket: bucket,
          Key: key,
        }));

        if (response.Body) {
          const bytes = await response.Body.transformToByteArray();
          const base64 = Buffer.from(bytes).toString('base64');
          const mediaType = artifact.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
          screenshots.push({ base64, mediaType });
        }
      } catch (err) {
        console.warn(`[SelfHeal] Failed to fetch screenshot ${artifact.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.warn('[SelfHeal] Failed to fetch screenshot artifacts:', err instanceof Error ? err.message : err);
  }

  return screenshots;
}

class SelfHealService {
  /**
   * Attempt to heal a failed test run by regenerating the spec
   */
  async healFailedRun(runId: string): Promise<SelfHealResult> {
    // 1. Load run + spec + recording
    const run = await prisma.testRun.findUnique({
      where: { id: runId },
      include: {
        testSpec: {
          include: {
            recording: {
              include: {
                project: true,
              },
            },
          },
        },
      },
    });

    if (!run) {
      return { healed: false, reason: 'Run not found' };
    }

    if (!run.testSpec) {
      return { healed: false, reason: 'No test spec associated with run' };
    }

    if (run.status !== 'FAILED') {
      return { healed: false, reason: `Run status is ${run.status}, not FAILED` };
    }

    // 2. Guard: check attempt count
    const spec = run.testSpec;
    const currentAttempt = (spec as unknown as { attempt?: number }).attempt || 1;
    const maxAttempts = (spec as unknown as { maxAttempts?: number }).maxAttempts || 3;
    if (currentAttempt >= maxAttempts) {
      return {
        healed: false,
        reason: `Max attempts reached (${currentAttempt}/${maxAttempts}). Error: ${run.error || 'Unknown'}`,
      };
    }

    // 3. Collect failure context
    const error = run.error || 'Test failed with no error message';
    const logs = run.logs || '';
    const category = categorizeFailure(error, logs);
    const diagnosis = diagnosisFromCategory(category, error);

    // Fetch screenshots from MinIO
    const screenshots = await fetchScreenshotArtifacts(runId);

    const failureContext: FailureContext = {
      previousCode: spec.code,
      error,
      logs: logs.slice(-3000), // Last 3000 chars
      diagnosis,
      category,
      screenshots,
      attempt: currentAttempt,
      maxAttempts,
    };

    // 4. Parse and analyze the recording
    const recording = spec.recording;
    if (!recording) {
      return { healed: false, reason: 'No recording associated with spec' };
    }

    const parseResult = RecordingSchema.safeParse(recording.jsonData);
    if (!parseResult.success) {
      return { healed: false, reason: `Invalid recording: ${parseResult.error.message}` };
    }

    const analysis = analyzeRecording(parseResult.data);

    // 5. Regenerate spec using Claude (Sonnet for speed)
    const regenerationModel = process.env.SELF_HEAL_MODEL || 'claude-sonnet-4-5-20250929';
    const generator = new CodeGenerator({
      model: regenerationModel,
      validateOutput: true,
    });

    console.log(`[SelfHeal] Regenerating spec for run ${runId}, attempt ${currentAttempt + 1}/${maxAttempts}, category: ${category}`);

    const result = await generator.regenerate(analysis, failureContext);

    if (!result.success || !result.code) {
      return {
        healed: false,
        reason: `Regeneration failed: ${result.errors?.join(', ') || 'Unknown error'}`,
      };
    }

    // 6. Save new TestSpec (new fields require type assertion until migration runs)
    const newSpec = await prisma.testSpec.create({
      data: {
        recordingId: recording.id,
        code: result.code,
        version: spec.version + 1,
        status: 'READY',
        patterns: spec.patterns as object || undefined,
        warnings: result.warnings || [],
        attempt: currentAttempt + 1,
        maxAttempts,
        parentSpecId: spec.id,
        failureContext: failureContext as unknown as object,
      } as Parameters<typeof prisma.testSpec.create>[0]['data'],
    });

    // 7. Create new TestRun and queue it
    const newRun = await prisma.testRun.create({
      data: {
        testSpecId: newSpec.id,
        status: 'PENDING',
        headless: run.headless,
        streamingMode: run.streamingMode,
        isAutoRetry: true,
      } as Parameters<typeof prisma.testRun.create>[0]['data'],
    });

    // Queue the execution
    const queueResult = await executionService.queueRun(newRun.id, {
      streamingMode: run.streamingMode as 'NONE' | 'VNC' | 'VIDEO',
    });

    console.log(`[SelfHeal] Created new spec ${newSpec.id} and run ${newRun.id} (queued: ${queueResult.queued})`);

    return {
      healed: true,
      newSpecId: newSpec.id,
      newRunId: newRun.id,
      reason: `Regenerated spec (attempt ${currentAttempt + 1}/${maxAttempts}), category: ${category}`,
    };
  }
}

export const selfHealService = new SelfHealService();
