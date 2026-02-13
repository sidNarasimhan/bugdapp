import type { ToolDefinition, ToolCallResult, ControlSignal } from '../types.js';

// ============================================================================
// Control Tool Definitions (for Claude API)
// ============================================================================

export const controlToolDefinitions: ToolDefinition[] = [
  {
    name: 'step_complete',
    description: 'Signal that the current intent step has been completed successfully. Call this when you have finished all actions for the current step and verified the outcome.',
    input_schema: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: 'ID of the completed step' },
        summary: { type: 'string', description: 'Brief summary of what was accomplished' },
      },
      required: ['stepId', 'summary'],
    },
  },
  {
    name: 'step_failed',
    description: 'Signal that the current intent step has failed and cannot be completed. Call this when you have exhausted all approaches to complete the step.',
    input_schema: {
      type: 'object',
      properties: {
        stepId: { type: 'string', description: 'ID of the failed step' },
        error: { type: 'string', description: 'Description of what went wrong and what was tried' },
      },
      required: ['stepId', 'error'],
    },
  },
  {
    name: 'test_complete',
    description: 'Signal that the entire test is complete. Call this after all steps have been processed (or if an unrecoverable error occurs). This ends the agent loop.',
    input_schema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean', description: 'Whether the test passed overall' },
        summary: { type: 'string', description: 'Summary of the test run results' },
      },
      required: ['passed', 'summary'],
    },
  },
];

// ============================================================================
// Control Tool Handlers
// ============================================================================

export function executeControlTool(
  toolName: string,
  input: Record<string, unknown>,
): ToolCallResult {
  switch (toolName) {
    case 'step_complete': {
      const signal: ControlSignal = {
        type: 'step_complete',
        stepId: input.stepId as string,
        summary: input.summary as string,
      };
      return {
        success: true,
        output: `Step "${input.stepId}" marked complete: ${input.summary}`,
        controlSignal: signal,
      };
    }

    case 'step_failed': {
      const signal: ControlSignal = {
        type: 'step_failed',
        stepId: input.stepId as string,
        error: input.error as string,
      };
      return {
        success: false,
        output: `Step "${input.stepId}" failed: ${input.error}`,
        controlSignal: signal,
      };
    }

    case 'test_complete': {
      const signal: ControlSignal = {
        type: 'test_complete',
        passed: input.passed as boolean,
        summary: input.summary as string,
      };
      return {
        success: input.passed as boolean,
        output: `Test complete: ${input.passed ? 'PASSED' : 'FAILED'} — ${input.summary}`,
        controlSignal: signal,
      };
    }

    default:
      return { success: false, output: `Unknown control tool: ${toolName}` };
  }
}
