import { bootstrap, getWallet } from '@tenkeylabs/dappwright';
import type { BrowserContext, Page } from 'playwright-core';
import type { Dappwright } from '@tenkeylabs/dappwright';
import { mkdirSync, existsSync, rmSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { startScreencastCapture, type ScreencastCapture } from '../screencast-capture.js';
import type {
  AgentRunResult,
  AgentConfig,
  AgentContext,
  AgentArtifact,
  IntentStep,
} from './types.js';
import { DEFAULT_AGENT_CONFIG } from './types.js';
import { buildIntentSteps } from './intent-builder.js';
import { runAgentLoop } from './agent-loop.js';

// Loose types for recording/analysis to avoid hard translator dependency
interface Recording {
  name: string;
  startUrl: string;
  steps: any[];
  walletConnected?: boolean;
  [key: string]: unknown;
}

interface AnalysisResult {
  recording: Recording;
  patterns: any[];
  detectedChainId?: number;
  testType: 'connection' | 'flow';
  dappConnectionPattern: string;
  [key: string]: unknown;
}

export interface AgentRunnerOptions {
  /** Artifacts output directory */
  artifactsDir: string;
  /** Whether to run headless */
  headless?: boolean;
  /** Override agent config */
  config?: Partial<AgentConfig>;
  /** Enable debug logging */
  debug?: boolean;
  /** Per-project dApp context (markdown) */
  dappContext?: string;
}

/**
 * Main orchestrator for agent-based test execution.
 * Bootstraps dappwright, builds intent steps, runs the agent loop, and collects artifacts.
 */
export class AgentRunner {
  private options: AgentRunnerOptions;
  private config: AgentConfig;
  private browserContext: BrowserContext | null = null;

  constructor(options: AgentRunnerOptions) {
    this.options = options;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required for agent mode');
    }

    this.config = {
      ...DEFAULT_AGENT_CONFIG,
      ...options.config,
      apiKey,
    };

    // Override model from env if set
    if (process.env.AGENT_MODEL) {
      this.config.model = process.env.AGENT_MODEL;
    }
  }

  /**
   * Abort the running agent by closing the browser context.
   * This will cause the run() method to throw.
   */
  abort(): void {
    if (this.browserContext) {
      console.log('[AgentRunner] Aborting — closing browser context');
      this.browserContext.close().catch(() => {});
      this.browserContext = null;
    }
  }

  /**
   * Run a test using the agent. This is the main entry point.
   *
   * @param recording - The recording JSON data
   * @param analysis - Pre-computed analysis result
   * @param testType - 'connection' or 'flow'
   * @param seedPhrase - Wallet seed phrase
   * @param connectionRecording - For flow tests, the connection recording to prepend
   * @param connectionAnalysis - Analysis of the connection recording
   */
  async run(
    recording: Recording,
    analysis: AnalysisResult,
    testType: 'connection' | 'flow',
    seedPhrase: string,
    connectionRecording?: Recording,
    connectionAnalysis?: AnalysisResult,
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const artifacts: AgentArtifact[] = [];

    // Clean and create artifacts directory
    if (existsSync(this.options.artifactsDir)) {
      rmSync(this.options.artifactsDir, { recursive: true, force: true });
    }
    mkdirSync(this.options.artifactsDir, { recursive: true });

    let wallet: Dappwright | undefined;
    let page: Page | undefined;
    let context: BrowserContext | undefined;
    let screencast: ScreencastCapture | null = null;

    try {
      // 1. Bootstrap dappwright (MetaMask + Chromium)
      console.log('[AgentRunner] Bootstrapping dappwright...');
      const headless = this.options.headless ?? (process.env.HEADLESS === 'true');

      // dappwright uses TEST_PARALLEL_INDEX to determine which worker downloads MetaMask.
      // Without it, bootstrap() waits forever for a "primary worker" that doesn't exist.
      if (!process.env.TEST_PARALLEL_INDEX) {
        process.env.TEST_PARALLEL_INDEX = '0';
      }

      // Retry bootstrap up to 3 times — MetaMask Manifest V3 can be slow to init on cold start
      const MAX_BOOTSTRAP_RETRIES = 3;
      let walletInstance: Dappwright | undefined;
      let browserContext: BrowserContext | undefined;

      for (let attempt = 1; attempt <= MAX_BOOTSTRAP_RETRIES; attempt++) {
        try {
          console.log(`[AgentRunner] Bootstrap attempt ${attempt}/${MAX_BOOTSTRAP_RETRIES}`);
          const result = await bootstrap('', {
            wallet: 'metamask',
            version: process.env.METAMASK_VERSION || '13.17.0',
            seed: seedPhrase,
            headless,
          });
          walletInstance = result[0];
          browserContext = result[2];
          break; // Success
        } catch (bootstrapError) {
          const msg = bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError);
          console.error(`[AgentRunner] Bootstrap attempt ${attempt} failed: ${msg}`);
          if (attempt === MAX_BOOTSTRAP_RETRIES) {
            throw bootstrapError; // Give up after all retries
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      wallet = walletInstance!;
      context = browserContext!;
      this.browserContext = context; // Store for abort()

      // Get a fresh wallet reference and the dApp page
      wallet = await getWallet('metamask', context);
      page = await context.newPage();

      // Start trace capture (screencast frames + actions for replay player)
      await context.tracing.start({ screenshots: true, snapshots: false, sources: false });

      // Start high-quality screencast capture (80% JPEG at 1280x720 vs trace's ~50% at 800x450)
      try {
        screencast = await startScreencastCapture(page, this.options.artifactsDir);
      } catch {
        console.warn('[AgentRunner] Could not start screencast capture');
      }

      console.log('[AgentRunner] dappwright bootstrapped successfully');

      // 2. Build intent steps
      let allSteps: IntentStep[] = [];

      // For flow tests, prepend connection steps
      if (testType === 'flow' && connectionRecording && connectionAnalysis) {
        console.log('[AgentRunner] Building connection intent steps (flow test)');
        const connectionSteps = buildIntentSteps(connectionAnalysis);
        allSteps.push(...connectionSteps);
      }

      // Build main intent steps
      console.log('[AgentRunner] Building intent steps from recording');
      const mainSteps = buildIntentSteps(analysis);
      allSteps.push(...mainSteps);

      console.log(`[AgentRunner] ${allSteps.length} total intent steps:`);
      for (const step of allSteps) {
        console.log(`  - [${step.id}] ${step.type}: ${step.description}`);
      }

      // 3. Create agent context
      const agentCtx: AgentContext = {
        page,
        context,
        wallet,
        snapshotRefs: new Map(),
        artifactsDir: this.options.artifactsDir,
        screenshotCounter: 0,
      };

      // 4. Run the agent loop
      console.log('[AgentRunner] Starting agent loop...');
      const loopResult = await runAgentLoop(
        allSteps,
        agentCtx,
        this.config,
        testType,
        recording.startUrl,
        this.options.dappContext,
      );

      // 5a. Stop screencast and bundle into screencast.zip
      if (screencast?.active) {
        try {
          const screencastPath = await screencast.stop();
          if (screencastPath) {
            artifacts.push({ type: 'trace', name: 'screencast.zip', path: screencastPath });
          }
        } catch (scErr) {
          console.warn(`[AgentRunner] Failed to save screencast: ${scErr instanceof Error ? scErr.message : String(scErr)}`);
        }
      }

      // 5b. Stop tracing and save trace.zip
      try {
        const tracePath = join(this.options.artifactsDir, 'trace.zip');
        await context.tracing.stop({ path: tracePath });
        artifacts.push({ type: 'trace', name: 'trace.zip', path: tracePath });
        console.log('[AgentRunner] Trace saved to trace.zip');
      } catch (traceError) {
        console.error(`[AgentRunner] Failed to save trace: ${traceError instanceof Error ? traceError.message : String(traceError)}`);
      }

      // 6. Collect artifacts
      const artifactFiles = this.collectArtifactFiles();
      artifacts.push(...artifactFiles);

      // 7. Save run log
      const logPath = join(this.options.artifactsDir, 'agent-run.log');
      const logContent = [
        `Agent Run: ${recording.name}`,
        `Test Type: ${testType}`,
        `Model: ${this.config.model}`,
        `Result: ${loopResult.testPassed ? 'PASSED' : 'FAILED'}`,
        `Summary: ${loopResult.testSummary}`,
        `Usage: ${loopResult.costTracker.toString()}`,
        '',
        'Step Results:',
        ...loopResult.stepResults.map((s) =>
          `  [${s.status.toUpperCase()}] ${s.description} (${s.apiCalls} calls, ${s.durationMs}ms)${s.error ? ` — ${s.error}` : ''}`
        ),
      ].join('\n');
      writeFileSync(logPath, logContent);
      artifacts.push({ type: 'log', name: 'agent-run.log', path: logPath });

      // 8. Save usage stats
      const usagePath = join(this.options.artifactsDir, 'usage.json');
      writeFileSync(usagePath, JSON.stringify(loopResult.costTracker.getUsage(), null, 2));

      const durationMs = Date.now() - startTime;

      return {
        passed: loopResult.testPassed,
        summary: loopResult.testSummary,
        steps: loopResult.stepResults,
        durationMs,
        usage: loopResult.costTracker.getUsage(),
        artifacts,
        error: loopResult.testPassed ? undefined : loopResult.testSummary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[AgentRunner] Fatal error: ${message}`);

      // Try to stop screencast and save partial capture
      if (screencast?.active) {
        try {
          const screencastPath = await screencast.stop();
          if (screencastPath) {
            artifacts.push({ type: 'trace', name: 'screencast.zip', path: screencastPath });
          }
        } catch { /* non-fatal */ }
      }

      // Try to stop tracing and save partial trace
      if (context) {
        try {
          const tracePath = join(this.options.artifactsDir, 'trace.zip');
          await context.tracing.stop({ path: tracePath });
          artifacts.push({ type: 'trace', name: 'trace.zip', path: tracePath });
        } catch {
          // Tracing may not have started
        }
      }

      // Try to capture a failure screenshot
      if (page && !page.isClosed()) {
        try {
          const screenshotPath = join(this.options.artifactsDir, 'fatal-error.png');
          await page.screenshot({ path: screenshotPath });
          artifacts.push({ type: 'screenshot', name: 'fatal-error.png', path: screenshotPath });
        } catch {
          // Can't screenshot
        }
      }

      return {
        passed: false,
        summary: `Fatal error: ${message}`,
        steps: [],
        durationMs: Date.now() - startTime,
        usage: { totalApiCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, estimatedCostUsd: 0 },
        artifacts,
        error: message,
      };
    } finally {
      // Cleanup
      if (context) {
        try {
          await context.close();
        } catch {
          // Already closed
        }
      }
    }
  }

  /**
   * Scan artifacts directory for created files.
   */
  private collectArtifactFiles(): AgentArtifact[] {
    const artifacts: AgentArtifact[] = [];

    if (!existsSync(this.options.artifactsDir)) return artifacts;

    const files: string[] = readdirSync(this.options.artifactsDir);

    for (const file of files) {
      const filePath = join(this.options.artifactsDir, file);
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
      // Skip files already handled as primary artifacts
      if (file === 'screencast.zip' || file === 'trace.zip') continue;

      if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
        artifacts.push({
          type: 'screenshot',
          name: file,
          path: filePath,
          stepId: this.extractStepId(file),
        });
      } else if (file.endsWith('.log') || file.endsWith('.json')) {
        artifacts.push({
          type: 'log',
          name: file,
          path: filePath,
        });
      }
    }

    return artifacts;
  }

  private extractStepId(filename: string): string | undefined {
    const match = filename.match(/step-(\d+)/);
    return match ? `step-${match[1]}` : undefined;
  }
}

/**
 * Create an AgentRunner instance.
 */
export function createAgentRunner(options: AgentRunnerOptions): AgentRunner {
  return new AgentRunner(options);
}
