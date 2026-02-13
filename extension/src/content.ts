/**
 * Content script for Web3 Test Recorder
 * Injected into all pages at document_start
 */

import type { ExtensionMessage, RecordedStep } from './types';
import { initWeb3Detection, stopWeb3Detection } from './lib/web3-detector';
import { initEventCapture, stopEventCapture } from './lib/event-capture';

console.log('Web3 Test Recorder: Content script loaded on', window.location.href);

// Track if we're currently recording
let isRecording = false;
let sessionId: string | null = null;

/**
 * Handle captured step - send to background
 */
function handleStepCaptured(step: RecordedStep): void {
  if (!isRecording || !sessionId) {
    return;
  }

  console.log('[Content] Step captured:', step.type, step.web3Method || step.selector);

  chrome.runtime.sendMessage(
    {
      type: 'STEP_CAPTURED',
      sessionId,
      step,
      timestamp: Date.now(),
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Content] Failed to send step:', chrome.runtime.lastError);
      }
    }
  );
}

/**
 * Detect if wallet is already connected
 * Looks for 0x addresses in the page and checks ethereum provider
 */
function detectWalletConnection(): { connected: boolean; address: string | null } {
  let connected = false;
  let address: string | null = null;

  if (typeof window.ethereum !== 'undefined') {
    const eth = window.ethereum as {
      selectedAddress?: string;
      accounts?: string[];
      isConnected?: () => boolean;
      _state?: { accounts?: string[] };
    };

    // Method 1: Check ethereum.selectedAddress
    if (eth.selectedAddress && eth.selectedAddress.startsWith('0x')) {
      connected = true;
      address = eth.selectedAddress;
      console.log('[Content] Wallet connected (selectedAddress):', address);
    }

    // Method 2: Check ethereum.isConnected() + internal state
    if (!connected && eth.isConnected?.()) {
      // Provider is connected, check for accounts in internal state
      const accounts = eth.accounts || eth._state?.accounts;
      if (accounts && accounts.length > 0 && accounts[0]?.startsWith('0x')) {
        connected = true;
        address = accounts[0];
        console.log('[Content] Wallet connected (isConnected+accounts):', address);
      }
    }
  }

  // Method 2: Look for 0x addresses in wallet connector elements
  if (!connected) {
    // Common selectors for wallet connection status
    const walletSelectors = [
      '[class*="wallet"]',
      '[class*="connect"]',
      '[class*="account"]',
      '[class*="address"]',
      'button',
      '[data-testid*="wallet"]',
      '[data-testid*="account"]',
    ];

    for (const selector of walletSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.textContent || '';
          // Look for ethereum address pattern (0x followed by 40 hex chars, or truncated like 0x1234...5678)
          const addressMatch = text.match(/0x[a-fA-F0-9]{4,}(?:\.\.\.[a-fA-F0-9]{4})?|0x[a-fA-F0-9]{40}/);
          if (addressMatch) {
            connected = true;
            address = addressMatch[0];
            console.log('[Content] Wallet connected (DOM):', address, 'in', selector);
            break;
          }
        }
        if (connected) break;
      } catch (e) {
        // Ignore selector errors
      }
    }
  }

  return { connected, address };
}

/**
 * Start recording session
 */
function startRecording(newSessionId: string): void {
  if (isRecording) {
    console.warn('[Content] Already recording, stopping first');
    stopRecording();
  }

  isRecording = true;
  sessionId = newSessionId;
  console.log('[Content] Recording started:', sessionId);

  // Detect wallet connection state
  const walletState = detectWalletConnection();

  // Send wallet state to background
  chrome.runtime.sendMessage({
    type: 'WALLET_STATE_DETECTED',
    sessionId: newSessionId,
    walletConnected: walletState.connected,
    walletAddress: walletState.address,
    timestamp: Date.now(),
  });

  // Initialize console log capture
  initConsoleCapture();

  // Initialize Web3 detection
  initWeb3Detection(sessionId, handleStepCaptured);

  // Initialize DOM event capture
  initEventCapture(sessionId);
}

/**
 * Stop recording session
 */
function stopRecording(): void {
  if (!isRecording) {
    return;
  }

  console.log('[Content] Recording stopped:', sessionId);

  // Stop console capture
  stopConsoleCapture();

  // Stop Web3 detection
  stopWeb3Detection();

  // Stop DOM event capture
  stopEventCapture();

  isRecording = false;
  sessionId = null;
}

/**
 * Handle messages from background
 */
function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean {
  console.log('[Content] Received message:', message.type);

  switch (message.type) {
    case 'START_RECORDING_TAB':
      startRecording(message.sessionId);
      sendResponse({ success: true });
      break;

    case 'STOP_RECORDING_TAB':
      stopRecording();
      sendResponse({ success: true });
      break;

    default:
      // Unknown message type
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // Async response
}

// Console log capture
let originalConsoleLog: typeof console.log | null = null;
let originalConsoleWarn: typeof console.warn | null = null;
let originalConsoleError: typeof console.error | null = null;

/**
 * Initialize console log capture — intercept console.log/warn/error and forward to background
 */
function initConsoleCapture(): void {
  originalConsoleLog = console.log;
  originalConsoleWarn = console.warn;
  originalConsoleError = console.error;

  const sendConsoleLog = (level: 'log' | 'warn' | 'error', args: unknown[]) => {
    try {
      chrome.runtime.sendMessage({
        type: 'CONSOLE_LOG',
        level,
        args: args.map((a) => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).slice(0, 5), // Limit to 5 args
        timestamp: Date.now(),
      }).catch(() => {});
    } catch {
      // Ignore — can't send message
    }
  };

  console.log = (...args: unknown[]) => {
    originalConsoleLog?.apply(console, args);
    sendConsoleLog('log', args);
  };

  console.warn = (...args: unknown[]) => {
    originalConsoleWarn?.apply(console, args);
    sendConsoleLog('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalConsoleError?.apply(console, args);
    sendConsoleLog('error', args);
  };

  // Capture unhandled errors
  window.addEventListener('error', (event) => {
    sendConsoleLog('error', [`Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`]);
  });

  window.addEventListener('unhandledrejection', (event) => {
    sendConsoleLog('error', [`Unhandled rejection: ${event.reason}`]);
  });
}

/**
 * Stop console log capture — restore original console methods
 */
function stopConsoleCapture(): void {
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
  if (originalConsoleWarn) {
    console.warn = originalConsoleWarn;
    originalConsoleWarn = null;
  }
  if (originalConsoleError) {
    console.error = originalConsoleError;
    originalConsoleError = null;
  }
}

/**
 * Initialize content script
 */
function init(): void {
  console.log('[Content] Content script initialized');

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(handleMessage);

  // Log window.ethereum status (informational only, not for detection)
  if (typeof window.ethereum !== 'undefined') {
    console.log('[Content] window.ethereum already present');
  } else {
    console.log('[Content] window.ethereum not present at init');
  }
}

// Initialize when script loads
init();

// Export for debugging
(window as unknown as { __web3TestRecorder: unknown }).__web3TestRecorder = {
  startRecording,
  stopRecording,
  isRecording: () => isRecording,
  sessionId: () => sessionId,
};
