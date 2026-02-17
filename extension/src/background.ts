/**
 * Background service worker for Web3 Test Recorder
 * Manifest V3 service worker - no persistent background page
 *
 * CRITICAL: All event listeners must be registered synchronously at top level
 * to survive service worker restarts.
 */

import type { ExtensionMessage, RecordedStep } from './types';
import type { SuccessSnapshot, SuccessState } from './lib/steps';
import {
  getRecordingState,
  setRecordingState,
  clearRecordingState,
  incrementStepCount,
  addRecordedStep,
  clearRecordedSteps,
  getRecordedSteps,
  updateStepTxStatus,
} from './lib/storage';
import {
  trackTransaction,
  cancelAllTracking,
  setStatusCallback,
  getActiveTrackingCount,
} from './lib/tx-tracker';
import { isChainSupported } from './lib/rpc-config';

console.log('Web3 Test Recorder: Service worker initialized');

// Set up transaction status callback - updates step status when receipt arrives
setStatusCallback(async (stepId, txHash, status, receipt) => {
  console.log(`[Background] Transaction ${txHash} status: ${status}`);
  try {
    await updateStepTxStatus(stepId, status, receipt);
  } catch (error) {
    console.error('[Background] Failed to update step tx status:', error);
  }
});

// Message handler - registered synchronously at top level
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    console.log('Background received message:', message.type, sender.tab?.id);

    // Handle message asynchronously
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate async response
    return true;
  }
);

/**
 * Async message handler
 */
async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'START_RECORDING':
      return handleStartRecording(message.tabId, message.url);

    case 'STOP_RECORDING':
      return handleStopRecording();

    case 'GET_RECORDING_STATE':
      return handleGetRecordingState();

    case 'GET_RECORDED_STEPS':
      return handleGetRecordedSteps();

    case 'DELETE_STEP':
      return handleDeleteStep(message.index);

    case 'CLEAR_RECORDING':
      return handleClearRecording();

    case 'RECORDING_STARTED':
      // Legacy: content script notification
      console.log('Recording started:', message.sessionId, 'in tab', sender.tab?.id);
      return { success: true };

    case 'RECORDING_STOPPED':
      // Legacy: content script notification
      console.log('Recording stopped:', message.sessionId, 'in tab', sender.tab?.id);
      return { success: true };

    case 'STEP_CAPTURED':
      return handleStepCaptured(message.sessionId, message.step);

    case 'EVENT_CAPTURED':
      return handleEventCaptured(message.event);

    case 'CONSOLE_LOG':
      return handleConsoleLog(message as unknown as { level: string; args: string[]; timestamp: number });

    case 'WALLET_STATE_DETECTED':
      return handleWalletStateDetected(
        (message as { sessionId: string; walletConnected: boolean; walletAddress: string | null }).sessionId,
        (message as { walletConnected: boolean }).walletConnected,
        (message as { walletAddress: string | null }).walletAddress
      );

    case 'CAPTURE_SUCCESS_STATE':
      return handleCaptureSuccessState();

    case 'GET_SUCCESS_STATE':
      return handleGetSuccessState();

    default:
      console.warn('Unknown message type:', message);
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Start recording on specified tab
 */
async function handleStartRecording(
  tabId: number,
  url: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    // Generate unique session ID
    const sessionId = crypto.randomUUID();

    // Clear any previous recorded steps
    await clearRecordedSteps();

    // Set recording state
    await setRecordingState({
      isRecording: true,
      sessionId,
      tabId,
      startTime: Date.now(),
      startUrl: url,
      stepCount: 0,
    });

    // Set badge on tab
    await chrome.action.setBadgeText({ tabId, text: 'REC' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF0000' });

    // Notify content script to start recording
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'START_RECORDING_TAB',
        sessionId,
        timestamp: Date.now(),
      });
      console.log('[Background] Sent START_RECORDING_TAB to tab', tabId);
    } catch (tabError) {
      console.warn('[Background] Could not send to tab, injecting content script:', tabError);

      // Content script not ready - try to inject it programmatically
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });

        // Wait a bit for content script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Retry sending the message
        await chrome.tabs.sendMessage(tabId, {
          type: 'START_RECORDING_TAB',
          sessionId,
          timestamp: Date.now(),
        });
        console.log('[Background] Sent START_RECORDING_TAB after script injection');
      } catch (injectError) {
        console.error('[Background] Failed to inject/notify content script:', injectError);
        // Clear recording state since we couldn't start
        await clearRecordingState();
        await chrome.action.setBadgeText({ tabId, text: '' });
        return {
          success: false,
          error: 'Could not start recording on this page. Try refreshing the page.',
        };
      }
    }

    console.log('Recording started:', sessionId, 'on tab', tabId);
    return { success: true, sessionId };
  } catch (error) {
    console.error('Failed to start recording:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Stop current recording
 */
async function handleStopRecording(): Promise<{ success: boolean; error?: string }> {
  try {
    const state = await getRecordingState();

    // Cancel all pending transaction tracking
    const activeCount = getActiveTrackingCount();
    if (activeCount > 0) {
      console.log(`[Background] Cancelling ${activeCount} active transaction trackers`);
      cancelAllTracking();
    }

    // Auto-capture stop snapshot BEFORE stopping the content script
    if (state.tabId) {
      try {
        const stopSnapshot = await captureSnapshotFromTab(state.tabId);
        if (stopSnapshot) {
          const existing = await getSuccessStateFromStorage();
          await chrome.storage.session.set({
            successState: { ...existing, stopSnapshot },
          });
          console.log('[Background] Auto-captured stop snapshot');
        }
      } catch (snapshotErr) {
        console.warn('[Background] Failed to capture stop snapshot:', snapshotErr);
      }
    }

    if (state.tabId) {
      // Notify content script to stop recording
      try {
        await chrome.tabs.sendMessage(state.tabId, {
          type: 'STOP_RECORDING_TAB',
          timestamp: Date.now(),
        });
        console.log('[Background] Sent STOP_RECORDING_TAB to tab', state.tabId);
      } catch (tabError) {
        console.warn('[Background] Could not send to tab:', tabError);
      }

      // Clear badge
      await chrome.action.setBadgeText({ tabId: state.tabId, text: '' });
    }

    // Stop recording but preserve startUrl/startTime so the preview/upload can use them
    await setRecordingState({
      isRecording: false,
      sessionId: null,
      tabId: null,
      stepCount: state.stepCount,
      startUrl: state.startUrl,
      startTime: state.startTime,
      walletConnected: state.walletConnected,
      walletAddress: state.walletAddress,
    });

    console.log('Recording stopped');
    return { success: true };
  } catch (error) {
    console.error('Failed to stop recording:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get current recording state
 */
async function handleGetRecordingState(): Promise<{
  success: boolean;
  state?: Awaited<ReturnType<typeof getRecordingState>>;
  hasSteps?: boolean;
  hasMarkedSuccess?: boolean;
  error?: string;
}> {
  try {
    const state = await getRecordingState();
    const steps = await getRecordedSteps();
    const hasSteps = steps.length > 0;
    const successState = await getSuccessStateFromStorage();
    const hasMarkedSuccess = !!successState?.markedSnapshot;
    return { success: true, state, hasSteps, hasMarkedSuccess };
  } catch (error) {
    console.error('Failed to get recording state:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get recorded steps
 */
async function handleGetRecordedSteps(): Promise<{
  success: boolean;
  steps?: Awaited<ReturnType<typeof getRecordedSteps>>;
  error?: string;
}> {
  try {
    const steps = await getRecordedSteps();
    return { success: true, steps };
  } catch (error) {
    console.error('Failed to get recorded steps:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete a step at specified index
 */
async function handleDeleteStep(index: number): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const steps = await getRecordedSteps();
    if (index < 0 || index >= steps.length) {
      return { success: false, error: 'Invalid step index' };
    }
    steps.splice(index, 1);
    await chrome.storage.session.set({ recordedSteps: steps });
    console.log(`[Background] Deleted step at index ${index}, ${steps.length} steps remaining`);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete step:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Clear all recording data
 */
async function handleClearRecording(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await clearRecordingState();
    await clearRecordedSteps();
    await chrome.storage.session.remove('successState');
    console.log('[Background] Recording cleared');
    return { success: true };
  } catch (error) {
    console.error('Failed to clear recording:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get current chain ID from recent steps
 * Looks for recent eth_chainId responses or chainId in steps
 */
async function getCurrentChainId(): Promise<number | null> {
  const steps = await getRecordedSteps();

  // Search backwards for most recent chain ID
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];

    // Check explicit chainId on step
    if (step.chainId) {
      return step.chainId;
    }

    // Check eth_chainId response
    if (step.web3Method === 'eth_chainId' && step.web3Result) {
      const chainId = parseInt(step.web3Result as string, 16);
      if (!isNaN(chainId)) {
        return chainId;
      }
    }
  }

  // Default to Ethereum mainnet if no chain info found
  return 1;
}

/**
 * Handle captured step from content script
 */
async function handleStepCaptured(
  sessionId: string,
  step: RecordedStep
): Promise<{ success: boolean; stepCount?: number; error?: string }> {
  try {
    const state = await getRecordingState();

    // Verify session matches
    if (!state.isRecording || state.sessionId !== sessionId) {
      console.warn('[Background] Step captured but session mismatch:', sessionId, state.sessionId);
      return { success: false, error: 'Session mismatch' };
    }

    // Capture screenshot after click and web3 steps
    if ((step.type === 'click' || step.type === 'web3') && state.tabId) {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(
          undefined as unknown as number, // current window
          { format: 'png' }
        );
        step.screenshot = dataUrl;
      } catch (screenshotErr) {
        // Don't fail the step if screenshot fails (e.g., tab not focused)
        console.warn('[Background] Screenshot capture failed:', screenshotErr);
      }
    }

    // Store step and increment count
    const stepCount = await addRecordedStep(step);
    await setRecordingState({ stepCount });

    console.log('[Background] Step captured:', step.type, step.web3Method || step.selector, 'Total:', stepCount);

    // Start transaction tracking for eth_sendTransaction with txHash
    if (
      step.type === 'web3' &&
      step.web3Method === 'eth_sendTransaction' &&
      step.txHash &&
      !step.web3Error
    ) {
      const chainId = step.chainId || (await getCurrentChainId()) || 1;

      if (isChainSupported(chainId)) {
        console.log(`[Background] Starting transaction tracking for ${step.txHash} on chain ${chainId}`);
        trackTransaction(step.txHash, chainId, step.id);
      } else {
        console.warn(`[Background] Chain ${chainId} not supported for transaction tracking`);
      }
    }

    return { success: true, stepCount };
  } catch (error) {
    console.error('[Background] Failed to handle step:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle captured event (legacy - will be replaced by handleStepCaptured)
 */
async function handleEventCaptured(
  event: ExtensionMessage & { type: 'EVENT_CAPTURED' } extends { event: infer E } ? E : never
): Promise<{ success: boolean }> {
  console.log('Event captured:', event.eventType);
  // Future: Store event in session buffer
  return { success: true };
}

/**
 * Handle console log from content script
 * Stores in session storage under 'consoleLogs' key (capped at 200 entries)
 */
async function handleConsoleLog(
  message: { level: string; args: string[]; timestamp: number }
): Promise<{ success: boolean }> {
  try {
    const result = await chrome.storage.session.get('consoleLogs');
    const logs: Array<{ level: string; args: string[]; timestamp: number }> = result.consoleLogs || [];

    logs.push({
      level: message.level,
      args: message.args,
      timestamp: message.timestamp,
    });

    // Cap at 200 entries
    if (logs.length > 200) {
      logs.splice(0, logs.length - 200);
    }

    await chrome.storage.session.set({ consoleLogs: logs });
    return { success: true };
  } catch {
    return { success: true }; // Don't fail on console log errors
  }
}

/**
 * Handle wallet state detection from content script
 */
async function handleWalletStateDetected(
  sessionId: string,
  walletConnected: boolean,
  walletAddress: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const state = await getRecordingState();

    // Verify session matches
    if (!state.isRecording || state.sessionId !== sessionId) {
      console.warn('[Background] Wallet state but session mismatch:', sessionId, state.sessionId);
      return { success: false, error: 'Session mismatch' };
    }

    // Update recording state with wallet info
    await setRecordingState({
      walletConnected,
      walletAddress,
    });

    console.log('[Background] Wallet state detected:', walletConnected ? `connected (${walletAddress})` : 'not connected');
    return { success: true };
  } catch (error) {
    console.error('[Background] Failed to handle wallet state:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Success State Capture
// ============================================================================

/**
 * Get success state from session storage
 */
async function getSuccessStateFromStorage(): Promise<SuccessState | null> {
  try {
    const result = await chrome.storage.session.get('successState');
    return result.successState || null;
  } catch {
    return null;
  }
}

/**
 * Capture a snapshot from the given tab (page state + screenshot)
 */
async function captureSnapshotFromTab(tabId: number): Promise<SuccessSnapshot | null> {
  try {
    // Get page state from content script
    let pageState: { visibleText: string[]; url: string; pageTitle: string; timestamp: number } | null = null;
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'CAPTURE_PAGE_STATE',
        timestamp: Date.now(),
      }) as { success: boolean; pageState?: typeof pageState };
      if (response?.success && response.pageState) {
        pageState = response.pageState;
      }
    } catch (err) {
      console.warn('[Background] Could not get page state from content script:', err);
    }

    // Capture screenshot
    let screenshot: string | undefined;
    try {
      screenshot = await chrome.tabs.captureVisibleTab(
        undefined as unknown as number,
        { format: 'png' }
      );
    } catch (err) {
      console.warn('[Background] Screenshot capture failed:', err);
    }

    if (!pageState && !screenshot) return null;

    return {
      visibleText: pageState?.visibleText || [],
      url: pageState?.url || '',
      pageTitle: pageState?.pageTitle || '',
      screenshot,
      timestamp: pageState?.timestamp || Date.now(),
    };
  } catch (error) {
    console.error('[Background] captureSnapshotFromTab failed:', error);
    return null;
  }
}

/**
 * Handle "Mark Success" button from popup
 */
async function handleCaptureSuccessState(): Promise<{ success: boolean; error?: string }> {
  try {
    const state = await getRecordingState();
    if (!state.tabId) {
      return { success: false, error: 'No active recording tab' };
    }

    const snapshot = await captureSnapshotFromTab(state.tabId);
    if (!snapshot) {
      return { success: false, error: 'Failed to capture page state' };
    }

    const existing = await getSuccessStateFromStorage();
    await chrome.storage.session.set({
      successState: { ...existing, markedSnapshot: snapshot },
    });

    console.log('[Background] Marked success state captured');
    return { success: true };
  } catch (error) {
    console.error('[Background] Failed to capture success state:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle GET_SUCCESS_STATE request from popup
 */
async function handleGetSuccessState(): Promise<{ success: boolean; successState?: SuccessState | null }> {
  const successState = await getSuccessStateFromStorage();
  return { success: true, successState };
}

// Handle extension installation - registered synchronously at top level
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('First install - initializing storage');
    // Initialize with default recording state
    clearRecordingState();
    // Legacy config for future use
    chrome.storage.local.set({
      sessions: [],
      config: {
        recordClicks: true,
        recordInputs: true,
        recordWeb3: true,
      },
    });
  }
});

// Handle tab updates - registered synchronously at top level
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('Tab loaded:', tabId, tab.url);

    // Re-apply badge and re-send recording state if this tab is being recorded
    const state = await getRecordingState();
    if (state.isRecording && state.tabId === tabId && state.sessionId) {
      await chrome.action.setBadgeText({ tabId, text: 'REC' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF0000' });

      // Re-notify content script (it reloads on navigation)
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'START_RECORDING_TAB',
          sessionId: state.sessionId,
          timestamp: Date.now(),
        });
        console.log('[Background] Re-sent START_RECORDING_TAB after navigation to tab', tabId);
      } catch (tabError) {
        console.warn('[Background] Could not re-send to tab:', tabError);
      }
    }
  }
});

// Handle tab closure - clear recording if recording tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getRecordingState();
  if (state.isRecording && state.tabId === tabId) {
    console.log('Recording tab closed, stopping recording');
    await clearRecordingState();
  }
});
