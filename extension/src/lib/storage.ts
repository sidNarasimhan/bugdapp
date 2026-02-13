/**
 * Type-safe chrome.storage wrapper for recording state persistence
 * Uses chrome.storage.session to survive service worker restarts
 * Session storage is cleared when browser closes
 */

export interface RecordingState {
  isRecording: boolean;
  sessionId: string | null;
  tabId: number | null;
  startTime: number | null;
  startUrl: string | null;
  stepCount: number;
  // Wallet connection state detected at recording start
  walletConnected: boolean;
  walletAddress: string | null;
}

const STORAGE_KEY = 'recordingState';

const DEFAULT_STATE: RecordingState = {
  isRecording: false,
  sessionId: null,
  tabId: null,
  startTime: null,
  startUrl: null,
  stepCount: 0,
  walletConnected: false,
  walletAddress: null,
};

/**
 * Get current recording state from chrome.storage.session
 * Returns default state if not found
 */
export async function getRecordingState(): Promise<RecordingState> {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      return { ...DEFAULT_STATE, ...result[STORAGE_KEY] };
    }
    return { ...DEFAULT_STATE };
  } catch (error) {
    console.error('Failed to get recording state:', error);
    return { ...DEFAULT_STATE };
  }
}

/**
 * Update recording state in chrome.storage.session
 * Merges partial state with existing state
 */
export async function setRecordingState(
  state: Partial<RecordingState>
): Promise<void> {
  try {
    const currentState = await getRecordingState();
    const newState = { ...currentState, ...state };
    await chrome.storage.session.set({ [STORAGE_KEY]: newState });
  } catch (error) {
    console.error('Failed to set recording state:', error);
    throw error;
  }
}

/**
 * Reset recording state to defaults
 */
export async function clearRecordingState(): Promise<void> {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: { ...DEFAULT_STATE } });
  } catch (error) {
    console.error('Failed to clear recording state:', error);
    throw error;
  }
}

/**
 * Increment step count atomically
 */
export async function incrementStepCount(): Promise<number> {
  const state = await getRecordingState();
  const newCount = state.stepCount + 1;
  await setRecordingState({ stepCount: newCount });
  return newCount;
}

// ============================================================================
// Recorded Steps Storage
// ============================================================================

import type { RecordedStep } from './steps';

const STEPS_STORAGE_KEY = 'recordedSteps';

/**
 * Add a recorded step to storage
 */
export async function addRecordedStep(step: RecordedStep): Promise<number> {
  try {
    const steps = await getRecordedSteps();
    steps.push(step);
    await chrome.storage.session.set({ [STEPS_STORAGE_KEY]: steps });
    return steps.length;
  } catch (error) {
    console.error('Failed to add recorded step:', error);
    throw error;
  }
}

/**
 * Get all recorded steps from storage
 */
export async function getRecordedSteps(): Promise<RecordedStep[]> {
  try {
    const result = await chrome.storage.session.get(STEPS_STORAGE_KEY);
    return result[STEPS_STORAGE_KEY] || [];
  } catch (error) {
    console.error('Failed to get recorded steps:', error);
    return [];
  }
}

/**
 * Clear all recorded steps from storage
 */
export async function clearRecordedSteps(): Promise<void> {
  try {
    await chrome.storage.session.set({ [STEPS_STORAGE_KEY]: [] });
  } catch (error) {
    console.error('Failed to clear recorded steps:', error);
    throw error;
  }
}

/**
 * Receipt metadata for transaction confirmation
 */
export interface TxReceiptMetadata {
  blockNumber: number;
  gasUsed: string;
  effectiveGasPrice?: string;
  contractAddress?: string;
}

/**
 * Update transaction status for a specific step
 * Used by transaction tracker when receipt is received
 */
export async function updateStepTxStatus(
  stepId: string,
  txStatus: 'pending' | 'confirmed' | 'failed' | 'timeout',
  receipt?: TxReceiptMetadata
): Promise<boolean> {
  try {
    const steps = await getRecordedSteps();
    const stepIndex = steps.findIndex((step) => step.id === stepId);

    if (stepIndex === -1) {
      console.warn(`[Storage] Step ${stepId} not found for status update`);
      return false;
    }

    // Update step with new status
    steps[stepIndex] = {
      ...steps[stepIndex],
      txStatus,
      // Store receipt metadata if provided
      ...(receipt && {
        txReceipt: {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          effectiveGasPrice: receipt.effectiveGasPrice,
          contractAddress: receipt.contractAddress,
        },
      }),
    };

    await chrome.storage.session.set({ [STEPS_STORAGE_KEY]: steps });
    console.log(`[Storage] Updated step ${stepId} txStatus to ${txStatus}`);
    return true;
  } catch (error) {
    console.error('Failed to update step tx status:', error);
    throw error;
  }
}
