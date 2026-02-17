/**
 * RecordedStep type for captured interactions
 * Used by event capture and web3 detection modules
 */

export interface RecordedStep {
  id: string;
  type: 'click' | 'input' | 'navigation' | 'web3';
  timestamp: number;

  // Screenshot captured after this step (base64 data URL)
  screenshot?: string;

  // UI interactions
  selector?: string;
  value?: string;
  url?: string;

  // Element metadata for step description
  metadata?: {
    tagName: string;
    text?: string;
    ariaLabel?: string;
    role?: string;
    dataTestId?: string;
    inputType?: string;
    inputName?: string;
    placeholder?: string;
    // DOM context for richer AI understanding
    parentOuterHTML?: string;
    nearbyText?: string;
    pageTitle?: string;
    headingContext?: string;
    // Toggle/switch metadata
    dataState?: string;
    ariaChecked?: string;
    nearbyLabel?: string;
  };

  // Web3 interactions
  web3Method?: string;
  web3Params?: unknown;
  web3Result?: unknown;
  web3Error?: { message: string; code?: number };
  chainId?: number;
  txHash?: string;
  txStatus?: 'pending' | 'confirmed' | 'failed' | 'timeout';

  // Transaction receipt metadata (populated after confirmation)
  txReceipt?: {
    blockNumber: number;
    gasUsed: string;
    effectiveGasPrice?: string;
    contractAddress?: string;
  };

  // EIP-6963 provider info
  web3ProviderInfo?: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
}

export interface RecordedTest {
  name: string;
  startUrl: string;
  steps: RecordedStep[];
  createdAt: Date;
  duration: number;
}

// ============================================================================
// Success State Types — Captured page state for verification assertions
// ============================================================================

export interface SuccessSnapshot {
  visibleText: string[];   // Key text visible in viewport (max 50 items)
  url: string;
  pageTitle: string;
  screenshot?: string;     // Base64 PNG from captureVisibleTab
  timestamp: number;
}

export interface SuccessState {
  markedSnapshot?: SuccessSnapshot;  // User pressed "Mark Success"
  stopSnapshot?: SuccessSnapshot;    // Auto-captured on Stop
  semanticGoal?: string;             // "Verify position opened"
}
