import { z } from 'zod';

// ============================================================================
// Recording Types - Structure of the JSON recording from the extension
// ============================================================================

export const Web3ProviderInfoSchema = z.object({
  icon: z.string().optional(),
  name: z.string(),
  rdns: z.string().optional(),
  uuid: z.string().optional(),
});

export const ClickStepSchema = z.object({
  id: z.string(),
  type: z.literal('click'),
  timestamp: z.number(),
  selector: z.string(),
  screenshot: z.string().optional(),
  metadata: z.object({
    dataTestId: z.string().optional(),
    tagName: z.string().optional(),
    text: z.string().optional(),
    ariaLabel: z.string().optional(),
    className: z.string().optional(),
    parentOuterHTML: z.string().optional(),
    nearbyText: z.string().optional(),
    pageTitle: z.string().optional(),
    headingContext: z.string().optional(),
  }).optional(),
});

export const InputStepSchema = z.object({
  id: z.string(),
  type: z.literal('input'),
  timestamp: z.number(),
  selector: z.string(),
  value: z.string(),
  screenshot: z.string().optional(),
  metadata: z.object({
    dataTestId: z.string().optional(),
    tagName: z.string().optional(),
    placeholder: z.string().optional(),
    inputType: z.string().optional(),
    parentOuterHTML: z.string().optional(),
    nearbyText: z.string().optional(),
    pageTitle: z.string().optional(),
    headingContext: z.string().optional(),
  }).optional(),
});

export const NavigationStepSchema = z.object({
  id: z.string(),
  type: z.literal('navigation'),
  timestamp: z.number(),
  url: z.string(),
  fromUrl: z.string().optional(),
});

export const Web3StepSchema = z.object({
  id: z.string(),
  type: z.literal('web3'),
  timestamp: z.number(),
  web3Method: z.string(),
  web3ProviderInfo: Web3ProviderInfoSchema.optional(),
  web3Result: z.any().optional(),
  web3Params: z.any().optional(),
  chainId: z.number().optional(),
  screenshot: z.string().optional(),
});

export const ScrollStepSchema = z.object({
  id: z.string(),
  type: z.literal('scroll'),
  timestamp: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
});

export const RecordingStepSchema = z.discriminatedUnion('type', [
  ClickStepSchema,
  InputStepSchema,
  NavigationStepSchema,
  Web3StepSchema,
  ScrollStepSchema,
]);

export const ConsoleLogEntrySchema = z.object({
  level: z.enum(['log', 'warn', 'error', 'info']),
  args: z.array(z.string()),
  timestamp: z.number(),
});

export const RecordingSchema = z.object({
  name: z.string(),
  startUrl: z.string(),
  durationMs: z.number().optional(),
  steps: z.array(RecordingStepSchema),
  // Wallet connection state detected at recording start
  walletConnected: z.boolean().optional().default(false),
  walletAddress: z.string().nullable().optional(),
  // Console logs captured during recording
  consoleLogs: z.array(ConsoleLogEntrySchema).optional(),
  metadata: z.object({
    browser: z.string().optional(),
    extensionVersion: z.string().optional(),
    recordedAt: z.string().optional(),
  }).optional(),
});

export type Web3ProviderInfo = z.infer<typeof Web3ProviderInfoSchema>;
export type ClickStep = z.infer<typeof ClickStepSchema>;
export type InputStep = z.infer<typeof InputStepSchema>;
export type NavigationStep = z.infer<typeof NavigationStepSchema>;
export type Web3Step = z.infer<typeof Web3StepSchema>;
export type ScrollStep = z.infer<typeof ScrollStepSchema>;
export type RecordingStep = z.infer<typeof RecordingStepSchema>;
export type Recording = z.infer<typeof RecordingSchema>;

// ============================================================================
// Flow Pattern Types - Detected patterns in user flows
// ============================================================================

export type FlowPatternType =
  | 'wallet_connect'
  | 'wallet_sign'
  | 'wallet_approve'
  | 'network_switch'
  | 'token_swap'
  | 'token_transfer'
  | 'nft_mint'
  | 'nft_transfer'
  | 'defi_deposit'
  | 'defi_withdraw'
  | 'trade_open'
  | 'trade_close'
  | 'form_fill'
  | 'navigation'
  | 'unknown';

export interface FlowPattern {
  type: FlowPatternType;
  startIndex: number;
  endIndex: number;
  steps: RecordingStep[];
  confidence: number; // 0-1
  metadata?: {
    walletName?: string;
    chainId?: number;
    tokenSymbol?: string;
    amount?: string;
    [key: string]: unknown;
  };
}

export type DappConnectionPattern = 'rainbowkit' | 'web3modal' | 'privy' | 'custom' | 'unknown';

export interface AnalysisResult {
  recording: Recording;
  patterns: FlowPattern[];
  detectedChainId?: number;
  detectedWallet?: string;
  suggestedImports: string[];
  warnings: string[];
  // Indicates if wallet was already connected at recording start
  walletConnected: boolean;
  walletAddress?: string | null;
  // Test type classification
  testType: 'connection' | 'flow';
  // Detected dApp connection pattern
  dappConnectionPattern: DappConnectionPattern;
}

// ============================================================================
// Self-Healing Types
// ============================================================================

export type FailureCategory =
  | 'selector'      // Element not found / wrong selector
  | 'timeout'       // Timeout waiting for element/condition
  | 'network'       // Network/navigation error
  | 'wallet'        // MetaMask/wallet interaction failure
  | 'assertion'     // Assertion failed
  | 'unknown';      // Unclassified

export interface FailureContext {
  previousCode: string;
  error: string;
  logs: string;
  diagnosis: string;
  category: FailureCategory;
  screenshots: Array<{ base64: string; mediaType: 'image/png' | 'image/jpeg' }>;
  attempt: number;
  maxAttempts: number;
}

// ============================================================================
// Code Generation Types
// ============================================================================

export interface GeneratedStep {
  comment?: string;
  code: string;
  indentLevel?: number;
}

export interface GeneratedSpec {
  testName: string;
  imports: string[];
  setupCode: string[];
  steps: GeneratedStep[];
  teardownCode: string[];
}

export interface GenerationOptions {
  targetWallet: 'metamask' | 'rabby' | 'coinbase';
  testFramework: 'playwright' | 'synpress' | 'dappwright';
  includeComments: boolean;
  includeScreenshots: boolean;
  selectorStrategy: 'data-testid' | 'text' | 'role' | 'css' | 'auto';
  /** Per-project dApp context (markdown) — wallet provider, UI structure, verification hints */
  dappContext?: string;
}

// ============================================================================
// Clarification Types
// ============================================================================

export interface ClarificationQuestion {
  id: string;
  type: 'selector' | 'wait' | 'network' | 'action' | 'general';
  question: string;
  context: string;
  stepIndex?: number;
  options?: string[];
  defaultAnswer?: string;
}

export interface ClarificationAnswer {
  questionId: string;
  answer: string;
}

// ============================================================================
// Network Configuration Types
// ============================================================================

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  symbol: string;
  blockExplorer?: string;
  isTestnet: boolean;
}

// ============================================================================
// Translation Result Types
// ============================================================================

export interface TranslationResult {
  success: boolean;
  code?: string;
  clarifications?: ClarificationQuestion[];
  errors?: string[];
  warnings?: string[];
  analysis?: AnalysisResult;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    line: number;
    column: number;
    message: string;
  }>;
  warnings: Array<{
    line: number;
    column: number;
    message: string;
  }>;
}
