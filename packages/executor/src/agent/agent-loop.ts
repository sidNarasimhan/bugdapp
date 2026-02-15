import Anthropic from '@anthropic-ai/sdk';
import type {
  IntentStep,
  AgentConfig,
  AgentContext,
  ToolCallResult,
  ControlSignal,
  ToolDefinition,
  StepResult,
  AgentAction,
  AgentStepData,
} from './types.js';
import { browserToolDefinitions, executeBrowserTool } from './tools/browser-tools.js';
import { walletToolDefinitions, executeWalletTool } from './tools/wallet-tools.js';
import { controlToolDefinitions, executeControlTool } from './tools/control-tools.js';
import { buildSystemPrompt, buildStepMessage } from './system-prompt.js';
import { CostTracker } from './cost-tracker.js';
import { isDeterministicStep, executeDeterministicStep } from './deterministic-steps.js';
import { join } from 'path';

// Collect all tool definitions
const ALL_TOOLS: ToolDefinition[] = [
  ...browserToolDefinitions,
  ...walletToolDefinitions,
  ...controlToolDefinitions,
];

// Tool names by category for routing
const BROWSER_TOOLS = new Set(browserToolDefinitions.map((t) => t.name));
const WALLET_TOOLS = new Set(walletToolDefinitions.map((t) => t.name));
const CONTROL_TOOLS = new Set(controlToolDefinitions.map((t) => t.name));

interface LoopResult {
  stepResults: AgentStepData[];
  costTracker: CostTracker;
  /** Whether the agent explicitly called test_complete */
  testCompleted: boolean;
  testPassed: boolean;
  testSummary: string;
}

/**
 * Run the agent loop for a set of intent steps.
 * Core loop: snapshot → Claude API → execute tools → repeat
 */
export async function runAgentLoop(
  steps: IntentStep[],
  ctx: AgentContext,
  config: AgentConfig,
  testType: 'connection' | 'flow',
  dappUrl: string,
  dappContext?: string,
): Promise<LoopResult> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const costTracker = new CostTracker(config.model);
  const stepResults: AgentStepData[] = [];
  const completedStepSummaries: string[] = [];
  let totalApiCalls = 0;
  let testCompleted = false;
  let testPassed = false;
  let testSummary = '';

  const systemPrompt = buildSystemPrompt(dappContext);

  // Format tools for Claude API
  const tools = ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    if (testCompleted) break;
    if (totalApiCalls >= config.maxApiCalls) {
      stepResults.push({
        stepId: steps[stepIdx].id,
        description: steps[stepIdx].description,
        status: 'failed',
        error: `Max API calls reached (${config.maxApiCalls})`,
        apiCalls: 0,
        durationMs: 0,
        actions: [],
      });
      break;
    }

    const step = steps[stepIdx];
    const stepStart = Date.now();
    let stepApiCalls = 0;
    let stepSignal: ControlSignal | undefined;
    const stepActions: AgentAction[] = [];

    console.log(`[Agent] Step ${stepIdx + 1}/${steps.length}: ${step.description}`);

    // Execute deterministic steps directly (no Claude API calls needed)
    if (isDeterministicStep(step)) {
      const result = await executeDeterministicStep(step, stepIdx, steps.length, ctx);

      if (result.status === 'passed') {
        stepResults.push(result);
        completedStepSummaries.push(`${step.description}: ${result.summary || 'done'}`);
        console.log(`[Agent] Step ${stepIdx + 1} PASSED [deterministic, 0 API calls, ${result.durationMs}ms]`);

        if (config.captureStepScreenshots) {
          try {
            await executeBrowserTool('browser_screenshot', { name: `step-${stepIdx + 1}-${step.type}` }, ctx);
          } catch { /* Non-fatal */ }
        }
        continue;
      }

      // Deterministic step failed — fall back to agent for this step
      console.log(`[Agent] Deterministic step failed (${result.error}), falling back to agent`);
    }

    // Build initial message for this step (AI-driven)
    const stepMessage = buildStepMessage(step, steps, stepIdx, testType, dappUrl, completedStepSummaries);

    // Conversation messages for this step
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: stepMessage },
    ];

    // Step loop: keep calling Claude until step is complete or limits hit
    while (!stepSignal && !testCompleted) {
      if (totalApiCalls >= config.maxApiCalls) {
        console.log(`[Agent] Max API calls reached (${config.maxApiCalls})`);
        break;
      }
      if (stepApiCalls >= config.maxCallsPerStep) {
        console.log(`[Agent] Max calls per step reached (${config.maxCallsPerStep})`);
        break;
      }

      try {
        // Call Claude API
        const response = await client.messages.create({
          model: config.model,
          max_tokens: 4096,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          tools: tools as Anthropic.Messages.Tool[],
          messages,
        });

        totalApiCalls++;
        stepApiCalls++;

        // Track usage
        if (response.usage) {
          costTracker.recordUsage(response.usage as {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          });
        }

        // Check stop reason
        if (response.stop_reason === 'end_turn') {
          // Claude finished without tool calls — shouldn't happen often
          // Extract any text content for logging
          const textContent = response.content
            .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
          if (textContent) {
            console.log(`[Agent] Claude text: ${textContent.slice(0, 200)}`);
          }

          // Add assistant response and ask to continue
          messages.push({ role: 'assistant', content: response.content });
          messages.push({
            role: 'user',
            content: 'Please continue working on the current step. Use browser_snapshot to see the page, perform the needed actions, and call step_complete or step_failed when done.',
          });
          continue;
        }

        if (response.stop_reason !== 'tool_use') {
          // Unexpected stop reason
          console.log(`[Agent] Unexpected stop reason: ${response.stop_reason}`);
          break;
        }

        // Process tool calls
        const toolBlocks = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
        );

        // Add assistant response to conversation
        messages.push({ role: 'assistant', content: response.content });

        // Execute each tool call and collect results
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

        for (const toolBlock of toolBlocks) {
          const toolInput = toolBlock.input as Record<string, unknown>;
          const actionStart = Date.now();
          let result: ToolCallResult;

          // Route to appropriate handler
          if (BROWSER_TOOLS.has(toolBlock.name)) {
            result = await executeBrowserTool(toolBlock.name, toolInput, ctx);
          } else if (WALLET_TOOLS.has(toolBlock.name)) {
            result = await executeWalletTool(toolBlock.name, toolInput, ctx);
          } else if (CONTROL_TOOLS.has(toolBlock.name)) {
            result = executeControlTool(toolBlock.name, toolInput);
          } else {
            result = { success: false, output: `Unknown tool: ${toolBlock.name}` };
          }

          // Log tool execution
          const status = result.success ? 'OK' : 'FAIL';
          console.log(`[Agent]   ${toolBlock.name} -> ${status}: ${result.output.slice(0, 150)}`);

          // Track action (skip browser_snapshot to reduce noise)
          if (toolBlock.name !== 'browser_snapshot') {
            const node = ctx.snapshotRefs.get(toolInput.ref as string);
            const action: AgentAction = {
              tool: toolBlock.name,
              input: {
                ...(toolInput.ref && { ref: toolInput.ref }),
                ...(toolInput.description && { description: toolInput.description }),
                ...(toolInput.text && { text: toolInput.text }),
                ...(toolInput.url && { url: toolInput.url }),
                ...(toolInput.key && { key: toolInput.key }),
                ...(toolInput.expression && { expression: toolInput.expression }),
                ...(toolInput.name && { name: toolInput.name }),
              },
              output: result.output.slice(0, 500),
              success: result.success,
              screenshotBefore: result._screenshotBefore,
              elementRef: toolInput.ref as string | undefined,
              elementDesc: node ? `${node.role} "${node.name}"` : undefined,
              durationMs: Date.now() - actionStart,
            };

            // Auto-screenshot after significant actions
            const significantTools = ['browser_click', 'browser_type', 'wallet_approve', 'wallet_switch_network'];
            if (result.success && significantTools.includes(toolBlock.name)) {
              try {
                const afterName = `action-${ctx.screenshotCounter}-after`;
                ctx.screenshotCounter++;
                const afterPath = join(ctx.artifactsDir, `${afterName}.png`);
                await ctx.page.screenshot({ path: afterPath, fullPage: false });
                action.screenshotAfter = `${afterName}.png`;
              } catch {
                // Screenshot failure is non-fatal
              }
            }

            stepActions.push(action);
          }

          // Check for control signals
          if (result.controlSignal) {
            if (result.controlSignal.type === 'test_complete') {
              testCompleted = true;
              testPassed = result.controlSignal.passed;
              testSummary = result.controlSignal.summary;
              stepSignal = result.controlSignal;
            } else {
              stepSignal = result.controlSignal;
            }
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result.output,
            is_error: !result.success,
          });
        }

        // Add tool results to conversation
        messages.push({ role: 'user', content: toolResults });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Agent] API error: ${message}`);

        // Rate limit or transient error — wait and retry
        if (message.includes('rate_limit') || message.includes('overloaded')) {
          console.log('[Agent] Rate limited, waiting 5 seconds...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        // Fatal error — fail the step
        stepSignal = {
          type: 'step_failed',
          stepId: step.id,
          error: `API error: ${message}`,
        };
        break;
      }
    }

    // Record step result
    const stepDuration = Date.now() - stepStart;

    if (stepSignal?.type === 'step_complete') {
      stepResults.push({
        stepId: step.id,
        description: step.description,
        status: 'passed',
        summary: stepSignal.summary,
        apiCalls: stepApiCalls,
        durationMs: stepDuration,
        actions: stepActions,
      });
      completedStepSummaries.push(`${step.description}: ${stepSignal.summary?.slice(0, 100) || 'done'}`);
      console.log(`[Agent] Step ${stepIdx + 1} PASSED (${stepApiCalls} calls, ${stepDuration}ms, ${stepActions.length} actions)`);
    } else if (stepSignal?.type === 'step_failed') {
      stepResults.push({
        stepId: step.id,
        description: step.description,
        status: 'failed',
        error: stepSignal.error,
        apiCalls: stepApiCalls,
        durationMs: stepDuration,
        actions: stepActions,
      });
      console.log(`[Agent] Step ${stepIdx + 1} FAILED: ${stepSignal.error}`);
    } else if (stepSignal?.type === 'test_complete') {
      stepResults.push({
        stepId: step.id,
        description: step.description,
        status: testPassed ? 'passed' : 'failed',
        summary: testSummary,
        apiCalls: stepApiCalls,
        durationMs: stepDuration,
        actions: stepActions,
      });
    } else {
      // Step ended without explicit signal (hit limits)
      stepResults.push({
        stepId: step.id,
        description: step.description,
        status: 'failed',
        error: 'Step did not complete within limits',
        apiCalls: stepApiCalls,
        durationMs: stepDuration,
        actions: stepActions,
      });
    }

    // Capture step screenshot if configured
    if (config.captureStepScreenshots) {
      try {
        const screenshotResult = await executeBrowserTool(
          'browser_screenshot',
          { name: `step-${stepIdx + 1}-${step.type}` },
          ctx
        );
        if (screenshotResult.success) {
          const lastResult = stepResults[stepResults.length - 1];
          lastResult.screenshotPath = `${ctx.artifactsDir}/step-${stepIdx + 1}-${step.type}.png`;
        }
      } catch {
        // Screenshot failure is non-fatal
      }
    }
  }

  // If agent didn't explicitly complete, determine result from step outcomes
  if (!testCompleted) {
    testCompleted = true;
    const failedSteps = stepResults.filter((s) => s.status === 'failed');
    testPassed = failedSteps.length === 0;
    testSummary = testPassed
      ? `All ${stepResults.length} steps passed`
      : `${failedSteps.length}/${stepResults.length} steps failed: ${failedSteps.map((s) => s.error).join('; ')}`;
  }

  console.log(`[Agent] Run complete: ${testPassed ? 'PASSED' : 'FAILED'} — ${costTracker.toString()}`);

  return {
    stepResults,
    costTracker,
    testCompleted,
    testPassed,
    testSummary,
  };
}

// ============================================================================
// Single-step agent — used by hybrid runner when a spec step fails
// ============================================================================

export interface SingleStepResult {
  passed: boolean;
  summary: string;
  apiCalls: number;
  costUsd: number;
  actions: AgentAction[];
}

/**
 * Run the agent loop for a single failed step.
 * The hybrid runner calls this when spec code fails — the agent takes over
 * for just that step, using the same browser session.
 *
 * @param ctx - Agent context (page, wallet, context) from the hybrid runner
 * @param stepDescription - Human-readable intent (e.g., "Select MetaMask from wallet options")
 * @param stepCode - The spec code that failed (for context)
 * @param error - The error that caused the failure
 * @param dappUrl - The dApp URL
 * @param completedSteps - Summaries of steps already completed
 * @param dappContext - Optional per-project dApp context
 */
export async function runSingleAgentStep(
  ctx: AgentContext,
  stepDescription: string,
  stepCode: string,
  error: string,
  dappUrl: string,
  completedSteps: string[],
  dappContext?: string,
  testGoal?: string,
  upcomingSteps?: string[],
): Promise<SingleStepResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { passed: false, summary: 'No ANTHROPIC_API_KEY', apiCalls: 0, costUsd: 0, actions: [] };
  }

  const model = process.env.AGENT_MODEL || 'claude-haiku-4-5-20251001';
  const client = new Anthropic({ apiKey });
  const costTracker = new CostTracker(model);
  const maxCalls = 15; // Single step shouldn't need many calls
  let apiCalls = 0;
  const stepActions: AgentAction[] = [];

  const systemPrompt = buildSystemPrompt(dappContext);

  const tools = ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  // Build initial message with failure context
  let userMsg = `## Recover Failed Step

A spec-based test step failed. You need to achieve the same goal using the browser.

**Goal**: ${stepDescription}
**dApp URL**: ${dappUrl}
`;

  if (testGoal) {
    userMsg += `**Overall Test Goal**: ${testGoal}\n`;
  }

  userMsg += `
### Failed spec code
\`\`\`typescript
${stepCode}
\`\`\`

### Error
\`\`\`
${error}
\`\`\`
`;

  if (completedSteps.length > 0) {
    userMsg += `\n### Already Completed Steps (DO NOT undo these)\n`;
    for (const s of completedSteps) {
      userMsg += `- ${s}\n`;
    }
  }

  if (upcomingSteps && upcomingSteps.length > 0) {
    userMsg += `\n### Upcoming Steps (what needs to happen AFTER this step)\n`;
    for (const s of upcomingSteps) {
      userMsg += `- ${s}\n`;
    }
    userMsg += `\nIMPORTANT: If the current step's target element doesn't exist but the page is already in the right state for the NEXT step, mark this step as complete — the UI may have changed since the recording was made.\n`;
  }

  userMsg += `\nStart by taking a browser_snapshot to see the current page state, then achieve the goal. Call step_complete when done or step_failed if impossible.`;

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: userMsg },
  ];

  let stepSignal: ControlSignal | undefined;

  while (!stepSignal && apiCalls < maxCalls) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        tools: tools as Anthropic.Messages.Tool[],
        messages,
      });

      apiCalls++;
      if (response.usage) {
        costTracker.recordUsage(response.usage as {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        });
      }

      if (response.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: 'Please continue. Use browser_snapshot to see the page and call step_complete or step_failed when done.',
        });
        continue;
      }

      if (response.stop_reason !== 'tool_use') break;

      const toolBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const toolBlock of toolBlocks) {
        const toolInput = toolBlock.input as Record<string, unknown>;
        const actionStart = Date.now();
        let result: ToolCallResult;

        if (BROWSER_TOOLS.has(toolBlock.name)) {
          result = await executeBrowserTool(toolBlock.name, toolInput, ctx);
        } else if (WALLET_TOOLS.has(toolBlock.name)) {
          result = await executeWalletTool(toolBlock.name, toolInput, ctx);
        } else if (CONTROL_TOOLS.has(toolBlock.name)) {
          result = executeControlTool(toolBlock.name, toolInput);
        } else {
          result = { success: false, output: `Unknown tool: ${toolBlock.name}` };
        }

        console.log(`[Agent:SingleStep] ${toolBlock.name} -> ${result.success ? 'OK' : 'FAIL'}: ${result.output.slice(0, 150)}`);

        // Track action (skip browser_snapshot to reduce noise)
        if (toolBlock.name !== 'browser_snapshot') {
          const node = ctx.snapshotRefs.get(toolInput.ref as string);
          stepActions.push({
            tool: toolBlock.name,
            input: {
              ...(toolInput.ref && { ref: toolInput.ref }),
              ...(toolInput.description && { description: toolInput.description }),
              ...(toolInput.text && { text: toolInput.text }),
              ...(toolInput.url && { url: toolInput.url }),
              ...(toolInput.key && { key: toolInput.key }),
              ...(toolInput.expression && { expression: toolInput.expression }),
              ...(toolInput.name && { name: toolInput.name }),
            },
            output: result.output.slice(0, 500),
            success: result.success,
            elementRef: toolInput.ref as string | undefined,
            elementDesc: node ? `${node.role} "${node.name}"` : undefined,
            durationMs: Date.now() - actionStart,
          });
        }

        if (result.controlSignal) {
          stepSignal = result.controlSignal;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result.output,
          is_error: !result.success,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('rate_limit') || message.includes('overloaded')) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      return {
        passed: false,
        summary: `API error: ${message}`,
        apiCalls,
        costUsd: costTracker.getUsage().estimatedCostUsd,
        actions: stepActions,
      };
    }
  }

  const usage = costTracker.getUsage();
  const passed = stepSignal?.type === 'step_complete' || stepSignal?.type === 'test_complete';
  const summary = stepSignal?.type === 'step_complete'
    ? stepSignal.summary
    : stepSignal?.type === 'step_failed'
      ? stepSignal.error
      : stepSignal?.type === 'test_complete'
        ? stepSignal.summary
        : 'Step did not complete within limits';

  console.log(`[Agent:SingleStep] ${passed ? 'PASSED' : 'FAILED'}: ${summary} (${apiCalls} calls, ~$${usage.estimatedCostUsd.toFixed(3)}, ${stepActions.length} actions)`);

  return {
    passed,
    summary,
    apiCalls,
    costUsd: usage.estimatedCostUsd,
    actions: stepActions,
  };
}
