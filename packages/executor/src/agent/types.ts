import type { Page, BrowserContext } from 'playwright-core';
import type { Dappwright } from '@tenkeylabs/dappwright';

// ============================================================================
// Intent Steps — semantic goals derived from recording
// ============================================================================

export interface IntentStep {
  id: string;
  /** Human-readable description of what this step achieves */
  description: string;
  /** Category of the step */
  type: IntentStepType;
  /** Original recording step indices this intent covers */
  sourceStepIndices: number[];
  /** Additional context for the agent */
  context?: Record<string, unknown>;
}

export type IntentStepType =
  | 'navigate'
  | 'connect_wallet'
  | 'sign_message'
  | 'switch_network'
  | 'confirm_transaction'
  | 'fill_form'
  | 'click_element'
  | 'verify_state'
  | 'dismiss_obstacle';

// ============================================================================
// Agent Run Result
// ============================================================================

export interface AgentRunResult {
  passed: boolean;
  /** Overall summary of what happened */
  summary: string;
  /** Per-step results */
  steps: StepResult[];
  /** Total duration in milliseconds */
  durationMs: number;
  /** API usage stats */
  usage: AgentUsage;
  /** Collected artifact paths */
  artifacts: AgentArtifact[];
  /** Error if the run failed */
  error?: string;
}

export interface StepResult {
  stepId: string;
  description: string;
  status: 'passed' | 'failed' | 'skipped';
  summary?: string;
  error?: string;
  /** Number of API calls used for this step */
  apiCalls: number;
  durationMs: number;
  screenshotPath?: string;
}

export interface AgentArtifact {
  type: 'screenshot' | 'log' | 'trace';
  name: string;
  path: string;
  stepId?: string;
}

export interface AgentUsage {
  totalApiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostUsd: number;
}

// ============================================================================
// Tool Definitions for Claude API
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCallResult {
  success: boolean;
  output: string;
  /** If the tool signals step/test completion */
  controlSignal?: ControlSignal;
  /** Screenshot taken before the action (internal, not sent to Claude) */
  _screenshotBefore?: string;
}

// ============================================================================
// Agent Replay Data — structured data for the dashboard replay timeline
// ============================================================================

export interface AgentAction {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
  screenshotBefore?: string;
  screenshotAfter?: string;
  elementRef?: string;
  elementDesc?: string;
  durationMs: number;
}

export interface AgentStepData extends StepResult {
  actions: AgentAction[];
}

export interface AgentRunData {
  steps: AgentStepData[];
  usage: AgentUsage;
  model: string;
}

export type ControlSignal =
  | { type: 'step_complete'; stepId: string; summary: string }
  | { type: 'step_failed'; stepId: string; error: string }
  | { type: 'test_complete'; passed: boolean; summary: string };

// ============================================================================
// Agent Context — passed to tool handlers
// ============================================================================

export interface AgentContext {
  page: Page;
  context: BrowserContext;
  wallet: Dappwright;
  /** Current accessibility snapshot refs → elements */
  snapshotRefs: Map<string, SnapshotNode>;
  /** Directory for saving screenshots */
  artifactsDir: string;
  /** Counter for screenshot naming */
  screenshotCounter: number;
}

export interface SnapshotNode {
  role: string;
  name: string;
  ref: string;
  /** Locator string to find this element */
  locatorStrategy: string;
}

// ============================================================================
// Agent Loop Configuration
// ============================================================================

export interface AgentConfig {
  /** Claude model to use */
  model: string;
  /** Max API calls before aborting */
  maxApiCalls: number;
  /** Max API calls per single intent step */
  maxCallsPerStep: number;
  /** Timeout per step in ms */
  stepTimeoutMs: number;
  /** Whether to capture screenshots after each step */
  captureStepScreenshots: boolean;
  /** Anthropic API key */
  apiKey: string;
}

export const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'apiKey'> = {
  model: 'claude-haiku-4-5-20251001',
  maxApiCalls: 60,
  maxCallsPerStep: 20,
  stepTimeoutMs: 90_000,
  captureStepScreenshots: true,
};

// ============================================================================
// Agent Job Data
// ============================================================================

export interface AgentRunJobData {
  runId: string;
  streamingMode?: 'NONE' | 'VNC' | 'VIDEO';
}
