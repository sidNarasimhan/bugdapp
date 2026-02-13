/**
 * Web3 detection utility for content script
 * Injects main world script and handles Web3 event messages
 */

import type { RecordedStep } from './steps';

// Track initialization state
let isInitialized = false;
let currentSessionId: string | null = null;

// Pending requests - correlate request/response
const pendingRequests = new Map<
  string,
  {
    method: string;
    params: unknown;
    timestamp: number;
    providerInfo?: {
      uuid: string;
      name: string;
      icon: string;
      rdns: string;
    };
  }
>();

// Callback for captured steps
let onStepCaptured: ((step: RecordedStep) => void) | null = null;

interface Web3RequestMessage {
  type: 'WEB3_REQUEST';
  id: string;
  method: string;
  params: unknown;
  timestamp: number;
  providerInfo?: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
}

interface Web3ResponseMessage {
  type: 'WEB3_RESPONSE';
  id: string;
  method: string;
  result?: unknown;
  error?: { message: string; code?: number };
  timestamp: number;
}

/**
 * Inject the main world script via script element
 */
function injectMainWorldScript(): void {
  // Use inline script for immediate execution (no module delay)
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  // Don't use type="module" - it delays execution

  // Inject as early as possible
  const target = document.head || document.documentElement;
  if (target) {
    target.insertBefore(script, target.firstChild);
  } else {
    // Fallback: wait for head
    const observer = new MutationObserver(() => {
      if (document.head) {
        document.head.insertBefore(script, document.head.firstChild);
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }

  console.log('[Web3Detector] Main world script injected');
}

/**
 * Send recording state to injected script
 */
function setRecordingState(isRecording: boolean): void {
  window.postMessage(
    {
      type: 'SET_RECORDING',
      isRecording,
    },
    '*'
  );
}

/**
 * Extract chain ID from eth_chainId response
 */
function extractChainId(result: unknown): number | undefined {
  if (typeof result === 'string') {
    // Convert hex string to number (e.g., "0x1" -> 1)
    return parseInt(result, 16);
  }
  if (typeof result === 'number') {
    return result;
  }
  return undefined;
}

/**
 * Extract transaction hash from eth_sendTransaction response
 */
function extractTxHash(method: string, result: unknown): string | undefined {
  if (method === 'eth_sendTransaction' && typeof result === 'string') {
    return result;
  }
  return undefined;
}

/**
 * Create RecordedStep from Web3 request/response pair
 */
function createWeb3Step(
  requestId: string,
  request: Web3RequestMessage,
  response: Web3ResponseMessage
): RecordedStep {
  const { method, params, providerInfo } = request;
  const { result, error } = response;

  const step: RecordedStep = {
    id: crypto.randomUUID(),
    type: 'web3',
    timestamp: request.timestamp,
    web3Method: method,
    web3Params: params,
    web3Result: error ? undefined : result,
    web3Error: error,
  };

  // Extract chain ID if this was a chainId request
  if (method === 'eth_chainId' && result) {
    step.chainId = extractChainId(result);
  }

  // Extract tx hash if this was a transaction
  const txHash = extractTxHash(method, result);
  if (txHash) {
    step.txHash = txHash;
    step.txStatus = 'pending'; // Will be updated by transaction tracker
  }

  // Add provider info if available (EIP-6963)
  if (providerInfo) {
    step.web3ProviderInfo = providerInfo;
  }

  return step;
}

/**
 * Handle Web3 request message from injected script
 */
function handleWeb3Request(message: Web3RequestMessage): void {
  const { id, method, params, timestamp, providerInfo } = message;

  // Store pending request for correlation
  pendingRequests.set(id, {
    method,
    params,
    timestamp,
    providerInfo,
  });

  console.log('[Web3Detector] Request:', method, params);
}

/**
 * Handle Web3 response message from injected script
 */
function handleWeb3Response(message: Web3ResponseMessage): void {
  const { id, method, result, error } = message;

  // Find matching request
  const request = pendingRequests.get(id);
  if (!request) {
    console.warn('[Web3Detector] No matching request for response:', id);
    return;
  }

  // Clean up pending request
  pendingRequests.delete(id);

  // Create request message object for step creation
  const requestMessage: Web3RequestMessage = {
    type: 'WEB3_REQUEST',
    id,
    method: request.method,
    params: request.params,
    timestamp: request.timestamp,
    providerInfo: request.providerInfo,
  };

  // Create and emit step
  const step = createWeb3Step(id, requestMessage, message);

  console.log('[Web3Detector] Response:', method, error ? 'ERROR' : 'SUCCESS');
  console.log('[Web3Detector] Step created:', step);

  // Emit step to callback
  if (onStepCaptured) {
    onStepCaptured(step);
  }
}

/**
 * Message listener for Web3 events from injected script
 */
function messageHandler(event: MessageEvent): void {
  // Only accept messages from same window
  if (event.source !== window) {
    return;
  }

  const message = event.data;

  if (message?.type === 'WEB3_REQUEST') {
    handleWeb3Request(message as Web3RequestMessage);
  } else if (message?.type === 'WEB3_RESPONSE') {
    handleWeb3Response(message as Web3ResponseMessage);
  }
}

/**
 * Initialize Web3 detection
 * Call this when recording starts
 */
export function initWeb3Detection(
  sessionId: string,
  stepCallback: (step: RecordedStep) => void
): void {
  if (isInitialized) {
    console.log('[Web3Detector] Already initialized, updating session');
    currentSessionId = sessionId;
    onStepCaptured = stepCallback;
    setRecordingState(true);
    return;
  }

  currentSessionId = sessionId;
  onStepCaptured = stepCallback;

  // Inject main world script
  injectMainWorldScript();

  // Listen for Web3 messages
  window.addEventListener('message', messageHandler);

  // Tell injected script to start recording
  // Small delay to ensure script is loaded
  setTimeout(() => {
    setRecordingState(true);
  }, 100);

  isInitialized = true;

  console.log('[Web3Detector] Initialized for session:', sessionId);
}

/**
 * Stop Web3 detection
 * Call this when recording stops
 */
export function stopWeb3Detection(): void {
  if (!isInitialized) {
    return;
  }

  // Tell injected script to stop recording
  setRecordingState(false);

  // Clear state
  currentSessionId = null;
  onStepCaptured = null;
  pendingRequests.clear();

  console.log('[Web3Detector] Stopped');
}

/**
 * Clean up Web3 detection completely
 * Call this when content script is unloaded
 */
export function cleanupWeb3Detection(): void {
  if (!isInitialized) {
    return;
  }

  // Remove message listener
  window.removeEventListener('message', messageHandler);

  // Clear state
  currentSessionId = null;
  onStepCaptured = null;
  pendingRequests.clear();
  isInitialized = false;

  console.log('[Web3Detector] Cleaned up');
}
