/**
 * Hybrid Runner — executes spec code in-process with per-step agent fallback.
 *
 * Instead of two separate execution paths (subprocess spec vs in-process agent),
 * this runner:
 * 1. Bootstraps a browser with dappwright (like agent mode)
 * 2. Parses the spec into steps using // STEP N: markers
 * 3. Executes each step's code directly against the browser
 * 4. If a step fails → invokes the agent for just that step
 * 5. Continues executing remaining spec steps in the same browser
 *
 * Result: ONE browser session, ONE process, and AI costs ONLY for failed steps.
 */

import { bootstrap, getWallet } from '@tenkeylabs/dappwright';
import type { BrowserContext, Page } from 'playwright-core';
import type { Dappwright } from '@tenkeylabs/dappwright';
import { expect } from '@playwright/test';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { raceApprove, raceSign } from './wallet-helpers.js';
import { runSingleAgentStep } from './agent/agent-loop.js';
import type { AgentContext, AgentAction } from './agent/types.js';

// ============================================================================
// Types
// ============================================================================

export interface SpecStep {
  number: number;
  description: string;
  code: string;
}

export interface HybridStepResult {
  stepNumber: number;
  description: string;
  passed: boolean;
  mode: 'spec' | 'agent';
  error?: string;
  agentApiCalls?: number;
  agentCostUsd?: number;
  durationMs: number;
}

export interface SpecPatch {
  stepNumber: number;
  patchedCode: string;
  reason: string;
}

export interface HybridRunResult {
  passed: boolean;
  steps: HybridStepResult[];
  durationMs: number;
  totalAgentCalls: number;
  totalAgentCostUsd: number;
  specPatches: SpecPatch[];
  artifacts: Array<{
    type: 'screenshot' | 'video' | 'trace' | 'log';
    name: string;
    path: string;
    stepName?: string;
  }>;
  logs: string;
  error?: string;
}

export interface HybridRunnerOptions {
  artifactsDir: string;
  headless?: boolean;
  debug?: boolean;
  dappContext?: string;
}

// ============================================================================
// Spec Parser
// ============================================================================

/**
 * Parse a spec file into individual steps based on STEP markers.
 *
 * Recognizes markers like:
 *   // ========================================
 *   // STEP 1: Navigate to Avantis trade page
 *   // ========================================
 *
 * or the Unicode variant:
 *   // ══════════════════════════════════════════
 *   // STEP 1: Navigate to Avantis trade page
 *   // ══════════════════════════════════════════
 */
export function parseSpecIntoSteps(specCode: string): SpecStep[] {
  // Extract the test body (everything inside the test function)
  const bodyCode = extractTestBody(specCode);
  if (!bodyCode) return [];

  // Split on STEP markers — match both ASCII '=' and Unicode '═'
  // Pattern: comment line of =/═, then STEP N: description, then another line of =/═
  const stepMarkerRegex = /\/\/\s*[═=]{3,}\s*\n\s*\/\/\s*STEP\s+(\d+):\s*(.+)\n\s*\/\/\s*[═=]{3,}/g;

  const matches = [...bodyCode.matchAll(stepMarkerRegex)];
  if (matches.length === 0) {
    // No step markers — return entire body as a single step
    return [{
      number: 1,
      description: 'Full test',
      code: bodyCode.trim(),
    }];
  }

  const steps: SpecStep[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const codeStart = match.index! + match[0].length;
    const codeEnd = i + 1 < matches.length ? matches[i + 1].index! : bodyCode.length;
    const code = bodyCode.slice(codeStart, codeEnd).trim();

    if (code) {
      steps.push({
        number: parseInt(match[1]),
        description: match[2].trim(),
        code,
      });
    }
  }

  return steps;
}

/**
 * Extract the test body from a spec file, stripping imports and test wrappers.
 */
function extractTestBody(specCode: string): string | null {
  // Strategy: find the test() call and extract the async body
  // Handles: test('name', async ({ wallet, page }) => { BODY })
  const lines = specCode.split('\n');
  let startLine = -1;
  let braceDepth = 0;
  let foundTestStart = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip import lines
    if (line.trim().startsWith('import ')) continue;

    // Find the test( opening
    if (!foundTestStart && /test\s*\(/.test(line)) {
      foundTestStart = true;
      // Count braces to find where the test body starts (after the opening {)
      for (const ch of line) {
        if (ch === '{') {
          braceDepth++;
          if (braceDepth === 1) {
            startLine = i + 1; // Body starts on next line
          }
        }
        if (ch === '}') braceDepth--;
      }
      // If brace opened and closed on same line or brace found, check startLine
      if (startLine === -1 && braceDepth > 0) {
        startLine = i + 1;
      }
      continue;
    }

    if (foundTestStart && startLine === -1) {
      // Still looking for the opening brace
      for (const ch of line) {
        if (ch === '{') {
          braceDepth++;
          if (braceDepth === 1) {
            startLine = i + 1;
          }
        }
        if (ch === '}') braceDepth--;
      }
    }
  }

  if (startLine === -1) return null;

  // Now find the matching closing brace
  braceDepth = 1;
  let endLine = lines.length;

  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      if (braceDepth === 0) {
        endLine = i;
        break;
      }
    }
    if (braceDepth === 0) break;
  }

  return lines.slice(startLine, endLine).join('\n');
}

/**
 * Strip TypeScript-specific syntax to make code eval-able as JavaScript.
 * Only handles patterns commonly found in generated specs.
 */
function stripTypeAnnotations(code: string): string {
  return code
    // Variable type annotations: let x: string | null = ... → let x = ...
    .replace(/\b(let|const|var)\s+(\w+)\s*:\s*[^=\n]+=\s*/g, '$1 $2 = ')
    // Variable type annotations without initializer: let x: string → let x
    .replace(/\b(let|const|var)\s+(\w+)\s*:\s*[\w\s|<>,[\]?]+$/gm, '$1 $2')
    // (window as any) -> (window)
    .replace(/\bas\s+any\b/g, '')
    // as string, as number, etc.
    .replace(/\bas\s+(?:string|number|boolean|unknown|void|never)\b/g, '')
    // as { ... } type assertions (greedy match to closing brace)
    .replace(/\bas\s+\{[^}]+\}/g, '')
    // as SomeType (capital letter = type name)
    .replace(/\bas\s+[A-Z]\w*(?:<[^>]+>)?/g, '')
    // Generic type params on function calls: fn<Type>(...) -> fn(...)
    // Only strip when preceded by identifier and followed by (
    .replace(/(?<=\w)<[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*>(?=\s*\()/g, '');
}

// ============================================================================
// Code Bug Detection
// ============================================================================

const CODE_BUG_PATTERN = /ReferenceError|SyntaxError|TypeError|Cannot find module/;
const NETWORK_ERROR_PATTERN = /net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/;

function isCodeBug(error: string): boolean {
  return CODE_BUG_PATTERN.test(error);
}

function isNetworkError(error: string): boolean {
  return NETWORK_ERROR_PATTERN.test(error);
}

// ============================================================================
// Step Executor
// ============================================================================

// AsyncFunction constructor for eval-ing async code
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Execute a single step's code in the browser context.
 * The code runs as an async function with page, wallet, context,
 * expect, raceApprove, and raceSign in scope.
 */
async function executeStepCode(
  code: string,
  page: Page,
  wallet: Dappwright,
  context: BrowserContext,
): Promise<void> {
  const jsCode = stripTypeAnnotations(code);

  const fn = new AsyncFunction(
    'page', 'wallet', 'context', 'expect', 'raceApprove', 'raceSign',
    jsCode,
  );

  await fn(page, wallet, context, expect, raceApprove, raceSign);
}

// ============================================================================
// Agent Actions → Spec Code Translation
// ============================================================================

/**
 * Convert an agent element description like `button "Market"` into a Playwright selector.
 */
function elementDescToSelector(desc?: string): string {
  if (!desc) return "page.locator('body')";
  // Parse `button "Market"` → page.getByRole('button', { name: 'Market' })
  const match = desc.match(/^(\w+)\s+"(.+)"$/);
  if (match) {
    const [, role, name] = match;
    return `page.getByRole('${role}', { name: '${name}' })`;
  }
  // Parse `button ""` → page.locator('[role="button"]')
  const roleMatch = desc.match(/^(\w+)\s+""$/);
  if (roleMatch) return `page.locator('[role="${roleMatch[1]}"]')`;
  return `page.locator('body')`;
}

/**
 * Translate agent actions into executable spec code.
 * Used to patch specs with what the agent learned.
 *
 * ONLY includes state-changing actions (clicks, typing, wallet ops).
 * Skips diagnostic/read-only actions (evaluate, snapshot) that the agent
 * uses to investigate the page but that don't belong in a spec.
 */
function agentActionsToSpecCode(actions: AgentAction[]): string {
  const lines: string[] = ['// Auto-patched by agent recovery'];
  let hasStateChanges = false;

  for (const action of actions) {
    if (!action.success) continue;
    switch (action.tool) {
      case 'browser_click': {
        const selector = elementDescToSelector(action.elementDesc);
        lines.push(`await ${selector}.click()`);
        lines.push('await page.waitForTimeout(500)');
        hasStateChanges = true;
        break;
      }
      case 'browser_type': {
        const selector = elementDescToSelector(action.elementDesc);
        const text = action.input.text as string || '';
        lines.push(`await ${selector}.fill(${JSON.stringify(text)})`);
        hasStateChanges = true;
        break;
      }
      case 'browser_press_key': {
        const key = action.input.key as string || 'Enter';
        lines.push(`await page.keyboard.press('${key}')`);
        hasStateChanges = true;
        break;
      }
      case 'browser_select': {
        const selector = elementDescToSelector(action.elementDesc);
        const value = action.input.value as string || '';
        lines.push(`await ${selector}.selectOption(${JSON.stringify(value)})`);
        hasStateChanges = true;
        break;
      }
      case 'wallet_switch_network': {
        const name = action.input.name as string || '';
        lines.push(`await wallet.switchNetwork('${name}')`);
        lines.push('await page.bringToFront()');
        lines.push('await page.waitForTimeout(5000)');
        hasStateChanges = true;
        break;
      }
      case 'wallet_approve': {
        lines.push('await raceApprove(wallet, context, page)');
        hasStateChanges = true;
        break;
      }
      case 'wallet_confirm_transaction': {
        lines.push('await wallet.confirmTransaction()');
        hasStateChanges = true;
        break;
      }
      // Skip read-only/diagnostic tools:
      // browser_evaluate — agent uses this to inspect page state, not to change it
      // browser_snapshot — page observation only
      // browser_navigate — agent might navigate to check something; specs handle their own navigation
      default:
        break;
    }
  }

  // If no state-changing actions were found, return empty string
  // (no point patching with just the comment header)
  if (!hasStateChanges) return '';
  return lines.join('\n');
}

// ============================================================================
// Hybrid Runner
// ============================================================================

/**
 * Run a spec in hybrid mode: spec code first, agent fallback per step.
 */
export async function runHybrid(
  specCode: string,
  seedPhrase: string,
  options: HybridRunnerOptions,
  dappUrl?: string,
): Promise<HybridRunResult> {
  const startTime = Date.now();
  const logLines: string[] = [];
  const artifacts: HybridRunResult['artifacts'] = [];
  const stepResults: HybridStepResult[] = [];
  const specPatches: SpecPatch[] = [];
  let totalAgentCalls = 0;
  let totalAgentCostUsd = 0;

  const log = (msg: string) => {
    console.log(`[Hybrid] ${msg}`);
    logLines.push(`[${new Date().toISOString()}] ${msg}`);
  };

  // Clean and create artifacts directory
  if (existsSync(options.artifactsDir)) {
    rmSync(options.artifactsDir, { recursive: true, force: true });
  }
  mkdirSync(options.artifactsDir, { recursive: true });

  // 1. Parse spec into steps
  const steps = parseSpecIntoSteps(specCode);
  if (steps.length === 0) {
    return {
      passed: false,
      steps: [],
      durationMs: Date.now() - startTime,
      totalAgentCalls: 0,
      totalAgentCostUsd: 0,
      specPatches: [],
      artifacts: [],
      logs: 'Failed to parse spec into steps',
      error: 'No steps found in spec code',
    };
  }

  log(`Parsed ${steps.length} steps from spec`);
  for (const step of steps) {
    log(`  Step ${step.number}: ${step.description}`);
  }

  // Extract test name/goal from spec
  const testNameMatch = specCode.match(/test\s*\(\s*['"]([^'"]+)['"]/);
  const testGoal = testNameMatch?.[1] || steps.map(s => s.description).join(' → ');

  // Infer dApp URL from step 1 if not provided
  if (!dappUrl) {
    const urlMatch = steps[0]?.code.match(/page\.goto\(['"]([^'"]+)['"]/);
    dappUrl = urlMatch?.[1] || 'unknown';
  }

  // 2. Bootstrap dappwright
  let wallet: Dappwright | undefined;
  let page: Page | undefined;
  let context: BrowserContext | undefined;

  try {
    log('Bootstrapping dappwright...');
    const headless = options.headless ?? (process.env.HEADLESS === 'true');

    // Kill any leftover Chrome zombies
    try {
      execSync('pkill -9 -f chrome 2>/dev/null || true', { stdio: 'ignore' });
    } catch { /* ignore */ }

    if (!process.env.TEST_PARALLEL_INDEX) {
      process.env.TEST_PARALLEL_INDEX = '0';
    }

    // Bootstrap with retry (MetaMask MV3 can be slow)
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log(`Bootstrap attempt ${attempt}/${MAX_RETRIES}`);
        const [w, , ctx] = await bootstrap('', {
          wallet: 'metamask',
          version: process.env.METAMASK_VERSION || '13.17.0',
          seed: seedPhrase,
          headless,
        });
        wallet = w;
        context = ctx;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Bootstrap attempt ${attempt} failed: ${msg}`);
        if (attempt === MAX_RETRIES) throw err;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    wallet = await getWallet('metamask', context!);
    page = await context!.newPage();

    // Start trace capture
    await context!.tracing.start({ screenshots: true, snapshots: false, sources: false });

    log('dappwright bootstrapped successfully');

    // 3. Execute each step: spec code first, agent if fails
    const completedStepSummaries: string[] = [];
    let stepIdx = 0;

    while (stepIdx < steps.length) {
      const step = steps[stepIdx];
      const stepStart = Date.now();
      log(`Step ${step.number}: ${step.description}`);

      try {
        // Execute spec code for this step
        await executeStepCode(step.code, page, wallet!, context!);

        const durationMs = Date.now() - stepStart;
        stepResults.push({
          stepNumber: step.number,
          description: step.description,
          passed: true,
          mode: 'spec',
          durationMs,
        });
        completedStepSummaries.push(`${step.description}: done`);
        log(`  PASSED [spec, ${durationMs}ms, $0]`);

        // Capture step screenshot
        try {
          const ssPath = join(options.artifactsDir, `step-${step.number}.png`);
          await page.screenshot({ path: ssPath, fullPage: false });
          artifacts.push({ type: 'screenshot', name: `step-${step.number}.png`, path: ssPath, stepName: `Step ${step.number}` });
        } catch { /* non-fatal */ }

      } catch (stepError) {
        const errorMsg = stepError instanceof Error ? stepError.message : String(stepError);
        log(`  Step ${step.number} spec FAILED: ${errorMsg}`);

        // Capture failure screenshot
        try {
          const ssPath = join(options.artifactsDir, `step-${step.number}-fail.png`);
          await page.screenshot({ path: ssPath, fullPage: false });
          artifacts.push({ type: 'screenshot', name: `step-${step.number}-fail.png`, path: ssPath, stepName: `Step ${step.number} (fail)` });
        } catch { /* non-fatal */ }

        // Code bugs and network errors: fail fast, no agent
        if (isCodeBug(errorMsg)) {
          log(`  Code bug detected — failing fast, no agent`);
          stepResults.push({
            stepNumber: step.number,
            description: step.description,
            passed: false,
            mode: 'spec',
            error: errorMsg,
            durationMs: Date.now() - stepStart,
          });
          // Code bugs affect all subsequent steps — abort
          break;
        }

        if (isNetworkError(errorMsg)) {
          log(`  Network error — failing fast, no agent`);
          stepResults.push({
            stepNumber: step.number,
            description: step.description,
            passed: false,
            mode: 'spec',
            error: errorMsg,
            durationMs: Date.now() - stepStart,
          });
          break;
        }

        // Invoke agent for this step (two-phase: dismiss → retry → full takeover)
        if (process.env.ANTHROPIC_API_KEY) {
          log(`  Invoking agent for step ${step.number} (Phase 1: dismiss blockers)...`);

          const agentCtx: AgentContext = {
            page,
            context: context!,
            wallet: wallet!,
            snapshotRefs: new Map(),
            artifactsDir: options.artifactsDir,
            screenshotCounter: 0,
          };

          try {
            // Phase 1: Ask agent to clear any blockers (narrow task)
            const dismissResult = await runSingleAgentStep(
              agentCtx,
              `Clear any overlay, modal, popup, or dialog that might be blocking interaction on the page. Do NOT perform the actual step action — just dismiss blockers.`,
              step.code,
              errorMsg,
              dappUrl!,
              completedStepSummaries,
              options.dappContext,
            );

            totalAgentCalls += dismissResult.apiCalls;
            totalAgentCostUsd += dismissResult.costUsd;

            let stepRecovered = false;

            // If agent dismissed something, retry original spec code
            if (dismissResult.passed && dismissResult.actions.length > 0) {
              log(`  Phase 1 cleared blockers (${dismissResult.actions.length} actions). Phase 2: retrying spec code...`);
              try {
                await executeStepCode(step.code, page, wallet!, context!);
                // Original code works now! Patch = dismissal prefix + original code
                const prefixCode = agentActionsToSpecCode(dismissResult.actions);
                if (prefixCode) {
                  specPatches.push({
                    stepNumber: step.number,
                    patchedCode: prefixCode + '\n' + step.code,
                    reason: `Cleared blocker: ${dismissResult.summary}`,
                  });
                }
                const durationMs = Date.now() - stepStart;
                stepResults.push({
                  stepNumber: step.number,
                  description: step.description,
                  passed: true,
                  mode: 'agent',
                  agentApiCalls: dismissResult.apiCalls,
                  agentCostUsd: dismissResult.costUsd,
                  durationMs,
                });
                completedStepSummaries.push(`${step.description}: done (dismiss+spec)`);
                log(`  PASSED [dismiss+spec, ${durationMs}ms, ~$${dismissResult.costUsd.toFixed(3)}]`);
                stepRecovered = true;
              } catch {
                log(`  Phase 2: spec retry still failed after clearing blockers`);
              }
            }

            // Phase 3: Agent fully takes over (original behavior)
            if (!stepRecovered) {
              log(`  Phase 3: full agent takeover for step ${step.number}...`);
              // Reset snapshot refs for fresh context
              agentCtx.snapshotRefs = new Map();

              // Give the agent context about the overall goal and upcoming steps
              const nextSteps = steps.slice(stepIdx + 1, stepIdx + 4);
              const upcomingDescriptions = nextSteps.map(s => `Step ${s.number}: ${s.description}`);

              const fullResult = await runSingleAgentStep(
                agentCtx,
                step.description,
                step.code,
                errorMsg,
                dappUrl!,
                completedStepSummaries,
                options.dappContext,
                testGoal,
                upcomingDescriptions,
              );

              totalAgentCalls += fullResult.apiCalls;
              totalAgentCostUsd += fullResult.costUsd;

              const durationMs = Date.now() - stepStart;
              stepResults.push({
                stepNumber: step.number,
                description: step.description,
                passed: fullResult.passed,
                mode: 'agent',
                error: fullResult.passed ? undefined : fullResult.summary,
                agentApiCalls: (dismissResult.apiCalls + fullResult.apiCalls),
                agentCostUsd: (dismissResult.costUsd + fullResult.costUsd),
                durationMs,
              });

              if (fullResult.passed) {
                completedStepSummaries.push(`${step.description}: done (agent)`);
                log(`  PASSED [agent, ${durationMs}ms, ~$${(dismissResult.costUsd + fullResult.costUsd).toFixed(3)}]`);

                // Check if agent's actions overlap with upcoming steps — skip them
                // Also filter overlapping actions OUT of the spec patch to prevent
                // baking in duplicate work from subsequent steps
                const overlappingTools = new Set<string>();
                if (fullResult.actions.length > 0) {
                  const agentToolNames = new Set(fullResult.actions.filter(a => a.success).map(a => a.tool));
                  let skipped = 0;
                  while (stepIdx + 1 + skipped < steps.length) {
                    const nextStep = steps[stepIdx + 1 + skipped];
                    const nextCode = nextStep.code.toLowerCase();
                    let alreadyDone = false;

                    // If agent confirmed a MetaMask tx and next step is confirmTransaction
                    if (agentToolNames.has('wallet_confirm_transaction') && nextCode.includes('confirmtransaction')) {
                      alreadyDone = true;
                      overlappingTools.add('wallet_confirm_transaction');
                    }
                    // If agent approved wallet and next step is raceApprove
                    if (agentToolNames.has('wallet_approve') && (nextCode.includes('raceapprove') || nextCode.includes('wallet.approve'))) {
                      alreadyDone = true;
                      overlappingTools.add('wallet_approve');
                    }

                    if (alreadyDone) {
                      skipped++;
                      log(`  Skipping step ${nextStep.number} (${nextStep.description}) — already done by agent`);
                      stepResults.push({
                        stepNumber: nextStep.number,
                        description: nextStep.description,
                        passed: true,
                        mode: 'agent',
                        durationMs: 0,
                      });
                      completedStepSummaries.push(`${nextStep.description}: done (skipped, agent already did it)`);
                    } else {
                      break;
                    }
                  }
                  stepIdx += skipped;
                }

                // Save spec patch — but EXCLUDE actions that belong to subsequent steps
                // and skip diagnostic-only actions (evaluate, snapshot)
                if (fullResult.actions.length > 0) {
                  const patchActions = overlappingTools.size > 0
                    ? fullResult.actions.filter(a => !overlappingTools.has(a.tool))
                    : fullResult.actions;
                  const patchCode = agentActionsToSpecCode(patchActions);
                  if (patchCode) {
                    specPatches.push({
                      stepNumber: step.number,
                      patchedCode: patchCode,
                      reason: fullResult.summary,
                    });
                  }
                }
              } else {
                log(`  FAILED [agent, ${durationMs}ms, ~$${(dismissResult.costUsd + fullResult.costUsd).toFixed(3)}]: ${fullResult.summary}`);
                break;
              }
            }
          } catch (agentError) {
            const agentMsg = agentError instanceof Error ? agentError.message : String(agentError);
            log(`  Agent error: ${agentMsg}`);
            stepResults.push({
              stepNumber: step.number,
              description: step.description,
              passed: false,
              mode: 'agent',
              error: agentMsg,
              durationMs: Date.now() - stepStart,
            });
            break;
          }
        } else {
          // No API key — can't invoke agent
          stepResults.push({
            stepNumber: step.number,
            description: step.description,
            passed: false,
            mode: 'spec',
            error: errorMsg,
            durationMs: Date.now() - stepStart,
          });
          break;
        }
      }
      stepIdx++;
    }

    // 4. Stop tracing and save trace.zip
    try {
      const tracePath = join(options.artifactsDir, 'trace.zip');
      await context!.tracing.stop({ path: tracePath });
      artifacts.push({ type: 'trace', name: 'trace.zip', path: tracePath });
    } catch (traceErr) {
      log(`Failed to save trace: ${traceErr instanceof Error ? traceErr.message : String(traceErr)}`);
    }

    // 5. Build result
    const allPassed = stepResults.length === steps.length && stepResults.every(s => s.passed);
    const failedSteps = stepResults.filter(s => !s.passed);

    const logContent = logLines.join('\n');
    const logPath = join(options.artifactsDir, 'hybrid-run.log');
    writeFileSync(logPath, logContent);
    artifacts.push({ type: 'log', name: 'hybrid-run.log', path: logPath });

    return {
      passed: allPassed,
      steps: stepResults,
      durationMs: Date.now() - startTime,
      totalAgentCalls,
      totalAgentCostUsd,
      specPatches,
      artifacts,
      logs: logContent,
      error: allPassed ? undefined : failedSteps.map(s => `Step ${s.stepNumber}: ${s.error}`).join('; '),
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Fatal error: ${message}`);

    // Try to capture failure screenshot
    if (page && !page.isClosed()) {
      try {
        const ssPath = join(options.artifactsDir, 'fatal-error.png');
        await page.screenshot({ path: ssPath });
        artifacts.push({ type: 'screenshot', name: 'fatal-error.png', path: ssPath });
      } catch { /* non-fatal */ }
    }

    // Try to save trace
    if (context) {
      try {
        const tracePath = join(options.artifactsDir, 'trace.zip');
        await context.tracing.stop({ path: tracePath });
        artifacts.push({ type: 'trace', name: 'trace.zip', path: tracePath });
      } catch { /* non-fatal */ }
    }

    const logContent = logLines.join('\n');
    const logPath = join(options.artifactsDir, 'hybrid-run.log');
    try { writeFileSync(logPath, logContent); } catch { /* ignore */ }

    return {
      passed: false,
      steps: stepResults,
      durationMs: Date.now() - startTime,
      totalAgentCalls,
      totalAgentCostUsd,
      specPatches,
      artifacts,
      logs: logContent,
      error: message,
    };
  } finally {
    if (context) {
      try { await context.close(); } catch { /* already closed */ }
    }
  }
}
