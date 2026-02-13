import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, copyFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

export interface RunnerOptions {
  headless?: boolean;
  timeout?: number;
  outputDir?: string;
  keepArtifacts?: boolean;
  debug?: boolean;
  // Directory containing dappwright test infrastructure (fixtures, config, etc.)
  testDir?: string;
}

export interface RunResult {
  success: boolean;
  passed: boolean;
  error?: string;
  durationMs: number;
  logs: string;
  artifacts: Array<{
    type: 'screenshot' | 'video' | 'trace' | 'log';
    name: string;
    path: string;
    stepName?: string;
  }>;
}

export interface SuiteSpec {
  id: string;
  code: string;
  name: string;
  isConnectTest: boolean;
}

export interface SuiteRunResult {
  success: boolean;
  durationMs: number;
  logs: string;
  artifacts: Array<{
    type: 'screenshot' | 'video' | 'trace' | 'log';
    name: string;
    path: string;
    stepName?: string;
  }>;
  perTestResults: Array<{
    specId: string;
    name: string;
    passed: boolean;
    durationMs?: number;
    error?: string;
  }>;
}

/**
 * Test runner that executes Playwright/dappwright specs
 * Uses dappwright-test directory as base for wallet fixtures and MetaMask handling
 */
export class TestRunner {
  private options: RunnerOptions;
  private testDir: string;

  constructor(options: RunnerOptions = {}) {
    this.options = {
      headless: false,
      timeout: 300000, // 5 minutes default
      keepArtifacts: true,
      debug: false,
      ...options,
    };

    // Locate dappwright-test directory (with fallback to legacy SYNPRESS_TEST_DIR)
    this.testDir = options.testDir
      || process.env.DAPPWRIGHT_TEST_DIR
      || process.env.SYNPRESS_TEST_DIR
      || join(process.cwd(), '..', '..', 'dappwright-test');
  }

  /**
   * Execute a test spec using dappwright-test infrastructure
   */
  async run(specCode: string, testName?: string, seedPhrase?: string): Promise<RunResult> {
    const startTime = Date.now();
    const runId = randomBytes(8).toString('hex');
    const artifactsDir = this.options.outputDir || join(tmpdir(), `executor-${runId}`, 'artifacts');

    // Write generated specs directly into test/playwright/
    const generatedTestsDir = process.env.GENERATED_TESTS_DIR || join(this.testDir, 'test', 'playwright');
    mkdirSync(generatedTestsDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    // Generate unique spec filename
    const specFileName = `run-${runId}.spec.ts`;
    const specPath = join(generatedTestsDir, specFileName);

    // Write the spec file
    writeFileSync(specPath, specCode);

    let logs = '';
    let error: string | undefined;
    let passed = false;

    try {
      // Clean stale test-results from previous runs so artifacts don't leak across runs
      const testResultsDir = join(this.testDir, 'test-results');
      if (existsSync(testResultsDir)) {
        try {
          rmSync(testResultsDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }

      // Kill any leftover Chrome zombie processes from previous runs
      try {
        execSync('pkill -9 -f chrome 2>/dev/null || true', { stdio: 'ignore' });
      } catch {
        // Ignore errors - no chrome processes to kill
      }

      // Run the test using dappwright-test's setup
      const result = await this.executePlaywrightTest(specPath, artifactsDir, seedPhrase);
      logs = result.output;
      passed = result.exitCode === 0;

      if (!passed && result.output) {
        // Extract error from output
        const errorMatch = result.output.match(/Error:.*$/m);
        error = errorMatch ? errorMatch[0] : 'Test failed';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown execution error';
      passed = false;
    } finally {
      // Clean up generated spec file
      if (!this.options.debug && existsSync(specPath)) {
        try {
          rmSync(specPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    // Collect artifacts from dappwright-test test-results
    const testResultsDir = join(this.testDir, 'test-results');
    const artifacts = this.collectArtifacts(artifactsDir, testResultsDir);

    return {
      success: !error,
      passed,
      error,
      durationMs: Date.now() - startTime,
      logs,
      artifacts,
    };
  }

  /**
   * Execute test using dappwright-test infrastructure
   * This leverages the dappwright fixtures for MetaMask wallet handling
   */
  private executePlaywrightTest(
    specPath: string,
    artifactsDir: string,
    seedPhrase?: string
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const args = [
        'playwright', 'test',
        specPath,
        '--reporter=list,json',
        `--output=${artifactsDir}`,
      ];

      // Only add --headed flag when we want headed mode
      if (!this.options.headless) {
        args.push('--headed');
      }

      // Build env — dappwright checks HEADLESS === 'true', so safe to set 'false'
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        DISPLAY: process.env.DISPLAY || ':99',
        HEADLESS: this.options.headless ? 'true' : 'false',
        PLAYWRIGHT_JSON_OUTPUT_NAME: join(artifactsDir, 'results.json'),
        ...(seedPhrase ? { SEED_PHRASE: seedPhrase } : {}),
      };

      const proc = spawn('npx', args, {
        cwd: this.testDir,
        shell: true,
        timeout: this.options.timeout,
        env,
      });

      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        if (this.options.debug) {
          process.stdout.write(data);
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        output += data.toString();
        if (this.options.debug) {
          process.stderr.write(data);
        }
      });

      proc.on('close', (code: number | null) => {
        resolve({
          exitCode: code ?? 1,
          output,
        });
      });

      proc.on('error', (err: Error) => {
        output += `\nProcess error: ${err.message}`;
        resolve({
          exitCode: 1,
          output,
        });
      });
    });
  }

  /**
   * Execute multiple specs as a serial suite in a single browser context.
   * Connect tests run first, subsequent tests inherit the wallet connection.
   */
  async runSuite(
    specs: SuiteSpec[],
    seedPhrase: string
  ): Promise<SuiteRunResult> {
    const startTime = Date.now();
    const runId = randomBytes(8).toString('hex');
    const artifactsDir = this.options.outputDir || join(tmpdir(), `executor-suite-${runId}`, 'artifacts');

    const generatedTestsDir = process.env.GENERATED_TESTS_DIR || join(this.testDir, 'test', 'playwright');
    mkdirSync(generatedTestsDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    // Build composite spec file
    const compositeCode = this.buildCompositeSpec(specs);
    const specFileName = `suite-${runId}.spec.ts`;
    const specPath = join(generatedTestsDir, specFileName);
    writeFileSync(specPath, compositeCode);

    let logs = '';
    let error: string | undefined;
    const perTestResults: SuiteRunResult['perTestResults'] = [];

    try {
      // Clean stale test-results
      const testResultsDir = join(this.testDir, 'test-results');
      if (existsSync(testResultsDir)) {
        try {
          rmSync(testResultsDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }

      // Kill any leftover Chrome zombie processes
      try {
        execSync('pkill -9 -f chrome 2>/dev/null || true', { stdio: 'ignore' });
      } catch {
        // Ignore
      }

      // Run with SEED_PHRASE env var so the fixture uses the project's wallet
      const result = await this.executeSuiteTest(specPath, artifactsDir, seedPhrase);
      logs = result.output;

      // Parse results.json for per-test results
      const resultsJsonPath = join(artifactsDir, 'results.json');
      if (existsSync(resultsJsonPath)) {
        try {
          const resultsData = JSON.parse(readFileSync(resultsJsonPath, 'utf-8'));
          this.parsePerTestResults(resultsData, specs, perTestResults);
        } catch {
          // If parsing fails, mark all as unknown based on exit code
        }
      }

      // If no per-test results parsed, derive from exit code
      if (perTestResults.length === 0) {
        const allPassed = result.exitCode === 0;
        for (const spec of specs) {
          perTestResults.push({
            specId: spec.id,
            name: spec.name,
            passed: allPassed,
            error: allPassed ? undefined : 'Unable to determine individual test result',
          });
        }
      }

      if (result.exitCode !== 0 && result.output) {
        const errorMatch = result.output.match(/Error:.*$/m);
        error = errorMatch ? errorMatch[0] : 'Suite failed';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown execution error';
      for (const spec of specs) {
        perTestResults.push({
          specId: spec.id,
          name: spec.name,
          passed: false,
          error: error,
        });
      }
    } finally {
      if (!this.options.debug && existsSync(specPath)) {
        try {
          rmSync(specPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    const testResultsDir = join(this.testDir, 'test-results');
    const artifacts = this.collectArtifacts(artifactsDir, testResultsDir);

    return {
      success: !error,
      durationMs: Date.now() - startTime,
      logs,
      artifacts,
      perTestResults,
    };
  }

  /**
   * Build a composite spec file from individual test specs.
   * Strips imports from individual specs, wraps test bodies in a serial describe block.
   */
  private buildCompositeSpec(specs: SuiteSpec[]): string {
    const lines: string[] = [
      "import { test, expect } from '../../fixtures/wallet.fixture';",
      '',
      "test.describe.serial('Project Suite', () => {",
    ];

    for (const spec of specs) {
      const body = this.extractTestBody(spec.code);
      const prefix = spec.isConnectTest ? 'connect: ' : '';
      const testName = `${prefix}${spec.name}`.replace(/'/g, "\\'");

      lines.push(`  test('${testName}', async ({ wallet, page }) => {`);
      // Indent the body
      for (const line of body.split('\n')) {
        lines.push(`    ${line}`);
      }
      lines.push('  });');
      lines.push('');
    }

    lines.push('});');
    return lines.join('\n');
  }

  /**
   * Extract the test body from a spec file, stripping imports and test wrappers.
   */
  private extractTestBody(code: string): string {
    // Remove import lines
    let stripped = code.replace(/^import\s+.*$/gm, '').trim();

    // Try to extract body from test('...', async ({ ... }) => { ... });
    const testBodyMatch = stripped.match(
      /test\s*\(\s*['"][^'"]*['"]\s*,\s*async\s*\(\s*\{[^}]*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/
    );

    if (testBodyMatch) {
      return testBodyMatch[1].trim();
    }

    // Try test.describe.serial wrapping
    const describeMatch = stripped.match(
      /test\.describe\.serial\s*\([^,]*,\s*\(\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/
    );

    if (describeMatch) {
      return describeMatch[1].trim();
    }

    // Return as-is if we can't parse
    return stripped;
  }

  /**
   * Execute the suite test with SEED_PHRASE env var
   */
  private executeSuiteTest(
    specPath: string,
    artifactsDir: string,
    seedPhrase: string
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const args = [
        'playwright', 'test',
        specPath,
        '--reporter=list,json',
        `--output=${artifactsDir}`,
      ];

      if (!this.options.headless) {
        args.push('--headed');
      }

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        DISPLAY: process.env.DISPLAY || ':99',
        HEADLESS: this.options.headless ? 'true' : 'false',
        SEED_PHRASE: seedPhrase,
        PLAYWRIGHT_JSON_OUTPUT_NAME: join(artifactsDir, 'results.json'),
      };

      const proc = spawn('npx', args, {
        cwd: this.testDir,
        shell: true,
        timeout: this.options.timeout,
        env,
      });

      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        if (this.options.debug) {
          process.stdout.write(data);
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        output += data.toString();
        if (this.options.debug) {
          process.stderr.write(data);
        }
      });

      proc.on('close', (code: number | null) => {
        resolve({ exitCode: code ?? 1, output });
      });

      proc.on('error', (err: Error) => {
        output += `\nProcess error: ${err.message}`;
        resolve({ exitCode: 1, output });
      });
    });
  }

  /**
   * Parse Playwright JSON results to extract per-test pass/fail
   */
  private parsePerTestResults(
    resultsData: { suites?: Array<{ specs?: Array<{ title: string; tests: Array<{ results: Array<{ status: string; duration: number; error?: { message?: string } }> }> }> }> },
    specs: SuiteSpec[],
    perTestResults: SuiteRunResult['perTestResults']
  ): void {
    const allSpecs = resultsData.suites?.flatMap((s) => s.specs || []) || [];

    for (const spec of specs) {
      const prefix = spec.isConnectTest ? 'connect: ' : '';
      const expectedTitle = `${prefix}${spec.name}`;

      const matchingSpec = allSpecs.find((s) => s.title === expectedTitle);

      if (matchingSpec && matchingSpec.tests.length > 0) {
        const test = matchingSpec.tests[0];
        const result = test.results[0];
        perTestResults.push({
          specId: spec.id,
          name: spec.name,
          passed: result?.status === 'passed',
          durationMs: result?.duration,
          error: result?.status !== 'passed' ? result?.error?.message || 'Test failed' : undefined,
        });
      } else {
        perTestResults.push({
          specId: spec.id,
          name: spec.name,
          passed: false,
          error: 'Test not found in results',
        });
      }
    }
  }

  /**
   * Execute a flow test with a connection spec prepended.
   * Builds a composite spec: connection test runs first, then the flow test inherits the wallet connection.
   */
  async runWithConnection(
    connectionCode: string,
    flowCode: string,
    seedPhrase: string
  ): Promise<RunResult> {
    // Build composite spec from connection + flow
    const connectionBody = this.extractTestBody(connectionCode);
    const flowBody = this.extractTestBody(flowCode);

    const compositeCode = [
      "import { test, expect } from '../../fixtures/wallet.fixture';",
      '',
      "test.describe.serial('Connection + Flow', () => {",
      "  test('connect wallet', async ({ wallet, page }) => {",
      ...connectionBody.split('\n').map((line) => `    ${line}`),
      '  });',
      '',
      "  test('flow test', async ({ wallet, page }) => {",
      ...flowBody.split('\n').map((line) => `    ${line}`),
      '  });',
      '});',
    ].join('\n');

    return this.run(compositeCode, 'connection-flow', seedPhrase);
  }

  /**
   * Legacy: Execute a standalone test spec (fallback without dappwright-test)
   */
  async runStandalone(specCode: string, _testName?: string): Promise<RunResult> {
    const startTime = Date.now();
    const runId = randomBytes(8).toString('hex');
    const workDir = join(tmpdir(), `executor-${runId}`);
    const artifactsDir = this.options.outputDir || join(workDir, 'artifacts');

    // Create directories
    mkdirSync(workDir, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });

    // Write the spec file
    const specPath = join(workDir, 'test.spec.ts');
    writeFileSync(specPath, specCode);

    // Write playwright config
    const configPath = join(workDir, 'playwright.config.ts');
    writeFileSync(configPath, this.generatePlaywrightConfig(artifactsDir));

    // Write package.json
    const packagePath = join(workDir, 'package.json');
    writeFileSync(packagePath, JSON.stringify({
      name: `test-run-${runId}`,
      type: 'module',
      dependencies: {
        '@playwright/test': '^1.51.0',
        '@tenkeylabs/dappwright': '2.13.3',
      },
    }, null, 2));

    let logs = '';
    let error: string | undefined;
    let passed = false;

    try {
      // Run the test
      const result = await this.executePlaywright(workDir, specPath);
      logs = result.output;
      passed = result.exitCode === 0;

      if (!passed && result.output) {
        // Extract error from output
        const errorMatch = result.output.match(/Error:.*$/m);
        error = errorMatch ? errorMatch[0] : 'Test failed';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown execution error';
      passed = false;
    }

    // Collect artifacts
    const artifacts = this.collectArtifacts(artifactsDir);

    // Cleanup if not keeping artifacts
    if (!this.options.keepArtifacts && existsSync(workDir)) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      success: !error,
      passed,
      error,
      durationMs: Date.now() - startTime,
      logs,
      artifacts,
    };
  }

  /**
   * Generate Playwright configuration (for standalone mode)
   */
  private generatePlaywrightConfig(artifactsDir: string): string {
    return `
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: ${this.options.timeout},
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '${artifactsDir.replace(/\\/g, '/')}/results.json' }]],
  use: {
    headless: ${this.options.headless},
    viewport: { width: 1280, height: 720 },
    screenshot: 'on',
    video: 'on',
    trace: 'on',
  },
  outputDir: '${artifactsDir.replace(/\\/g, '/')}',
});
`;
  }

  /**
   * Execute Playwright test (standalone mode)
   */
  private executePlaywright(
    workDir: string,
    specPath: string
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const args = ['playwright', 'test', specPath, '--config', 'playwright.config.ts'];

      if (this.options.debug) {
        args.push('--debug');
      }

      const proc = spawn('npx', args, {
        cwd: workDir,
        shell: true,
        timeout: this.options.timeout,
        env: {
          ...process.env,
          HEADLESS: this.options.headless ? 'true' : 'false',
        },
      });

      let output = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        if (this.options.debug) {
          process.stdout.write(data);
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        output += data.toString();
        if (this.options.debug) {
          process.stderr.write(data);
        }
      });

      proc.on('close', (code: number | null) => {
        resolve({
          exitCode: code ?? 1,
          output,
        });
      });

      proc.on('error', (err: Error) => {
        output += `\nProcess error: ${err.message}`;
        resolve({
          exitCode: 1,
          output,
        });
      });
    });
  }

  /**
   * Collect artifacts from the output directory (and optionally test results)
   */
  private collectArtifacts(
    artifactsDir: string,
    testResultsDir?: string
  ): Array<{ type: 'screenshot' | 'video' | 'trace' | 'log'; name: string; path: string; stepName?: string }> {
    const artifacts: Array<{
      type: 'screenshot' | 'video' | 'trace' | 'log';
      name: string;
      path: string;
      stepName?: string;
    }> = [];

    // Collect from primary artifacts directory
    if (existsSync(artifactsDir)) {
      this.collectFromDir(artifactsDir, artifacts);
    }

    // Also collect from test-results if provided
    if (testResultsDir && existsSync(testResultsDir)) {
      this.collectFromDir(testResultsDir, artifacts);
    }

    return artifacts;
  }

  /**
   * Helper to collect artifacts from a single directory
   */
  private collectFromDir(
    dir: string,
    artifacts: Array<{ type: 'screenshot' | 'video' | 'trace' | 'log'; name: string; path: string; stepName?: string }>
  ): void {
    const files = this.walkDir(dir);

    for (const file of files) {
      const ext = file.split('.').pop()?.toLowerCase();
      let type: 'screenshot' | 'video' | 'trace' | 'log';

      if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
        type = 'screenshot';
      } else if (ext === 'webm' || ext === 'mp4') {
        type = 'video';
      } else if (ext === 'zip' && file.includes('trace')) {
        type = 'trace';
      } else if (ext === 'txt' || ext === 'log' || ext === 'json') {
        type = 'log';
      } else {
        continue;
      }

      // Avoid duplicates
      const name = file.split(/[/\\]/).pop() || file;
      if (!artifacts.some(a => a.name === name && a.type === type)) {
        artifacts.push({
          type,
          name,
          path: file,
        });
      }
    }
  }

  /**
   * Recursively walk a directory and return all file paths
   */
  private walkDir(dir: string): string[] {
    const files: string[] = [];

    if (!existsSync(dir)) {
      return files;
    }

    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.walkDir(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }
}

/**
 * Create a test runner with the given options
 */
export function createRunner(options?: RunnerOptions): TestRunner {
  return new TestRunner(options);
}

/**
 * Run a test spec and return the result
 */
export async function runSpec(specCode: string, options?: RunnerOptions, seedPhrase?: string): Promise<RunResult> {
  const runner = createRunner(options);
  return runner.run(specCode, undefined, seedPhrase);
}
