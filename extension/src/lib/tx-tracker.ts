/**
 * Transaction receipt tracking for Web3 Test Recorder
 * Polls RPC endpoints for transaction receipts and updates step status
 */

import { getRpcUrl, getChainName } from './rpc-config';

export type TxStatus = 'pending' | 'confirmed' | 'failed' | 'timeout';

/**
 * Transaction receipt from eth_getTransactionReceipt
 */
export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  status: string; // '0x1' for success, '0x0' for failure
  gasUsed: string;
  effectiveGasPrice?: string;
  from: string;
  to: string | null;
  contractAddress: string | null;
}

/**
 * Receipt metadata stored with step
 */
export interface ReceiptMetadata {
  blockNumber: number;
  gasUsed: string;
  effectiveGasPrice?: string;
  contractAddress?: string;
}

/**
 * Callback when transaction status changes
 */
export type StatusCallback = (
  stepId: string,
  txHash: string,
  status: TxStatus,
  receipt?: ReceiptMetadata
) => void;

// Polling configuration
export const POLL_INTERVAL_MS = 2000;
export const TIMEOUT_MS = 60000;

// Active tracking state
interface TrackingEntry {
  txHash: string;
  chainId: number;
  stepId: string;
  startTime: number;
  intervalId: ReturnType<typeof setInterval>;
}

const activeTracking = new Map<string, TrackingEntry>();
let statusCallback: StatusCallback | null = null;

/**
 * Set callback for status updates
 */
export function setStatusCallback(callback: StatusCallback): void {
  statusCallback = callback;
}

/**
 * Clear status callback
 */
export function clearStatusCallback(): void {
  statusCallback = null;
}

/**
 * Poll for transaction receipt
 */
async function pollReceipt(
  txHash: string,
  rpcUrl: string
): Promise<TransactionReceipt | null> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });

    if (!response.ok) {
      console.warn(`[TxTracker] RPC request failed: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.warn(`[TxTracker] RPC error:`, data.error);
      return null;
    }

    // Returns null if transaction not yet mined
    return data.result as TransactionReceipt | null;
  } catch (error) {
    console.warn(`[TxTracker] Failed to poll receipt for ${txHash}:`, error);
    return null;
  }
}

/**
 * Start tracking a transaction
 */
export function trackTransaction(
  txHash: string,
  chainId: number,
  stepId: string
): boolean {
  // Check if already tracking
  if (activeTracking.has(txHash)) {
    console.log(`[TxTracker] Already tracking ${txHash}`);
    return false;
  }

  // Get RPC URL for chain
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    console.warn(
      `[TxTracker] No RPC configured for chain ${chainId}, cannot track ${txHash}`
    );
    return false;
  }

  const chainName = getChainName(chainId);
  console.log(
    `[TxTracker] Starting tracking for ${txHash} on ${chainName} (${chainId})`
  );

  const startTime = Date.now();

  // Start polling interval
  const intervalId = setInterval(async () => {
    const entry = activeTracking.get(txHash);
    if (!entry) {
      return;
    }

    // Check timeout
    const elapsed = Date.now() - entry.startTime;
    if (elapsed >= TIMEOUT_MS) {
      console.log(`[TxTracker] Timeout for ${txHash} after ${elapsed}ms`);
      clearInterval(entry.intervalId);
      activeTracking.delete(txHash);
      statusCallback?.(stepId, txHash, 'timeout');
      return;
    }

    // Poll for receipt
    const receipt = await pollReceipt(txHash, rpcUrl);

    if (receipt) {
      // Transaction mined - check status
      // status '0x1' = success, '0x0' = reverted
      const status: TxStatus = receipt.status === '0x1' ? 'confirmed' : 'failed';
      const blockNumber = parseInt(receipt.blockNumber, 16);

      console.log(
        `[TxTracker] Transaction ${txHash} ${status} in block ${blockNumber}`
      );

      // Stop tracking
      clearInterval(entry.intervalId);
      activeTracking.delete(txHash);

      // Extract receipt metadata
      const metadata: ReceiptMetadata = {
        blockNumber,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        contractAddress: receipt.contractAddress || undefined,
      };

      // Notify via callback
      statusCallback?.(stepId, txHash, status, metadata);
    }
  }, POLL_INTERVAL_MS);

  // Store tracking entry
  activeTracking.set(txHash, {
    txHash,
    chainId,
    stepId,
    startTime,
    intervalId,
  });

  return true;
}

/**
 * Cancel tracking for a specific transaction
 */
export function cancelTracking(txHash: string): boolean {
  const entry = activeTracking.get(txHash);
  if (!entry) {
    return false;
  }

  console.log(`[TxTracker] Cancelling tracking for ${txHash}`);
  clearInterval(entry.intervalId);
  activeTracking.delete(txHash);
  return true;
}

/**
 * Cancel all active transaction tracking
 */
export function cancelAllTracking(): void {
  const count = activeTracking.size;
  if (count === 0) {
    return;
  }

  console.log(`[TxTracker] Cancelling all tracking (${count} transactions)`);
  for (const [txHash, entry] of activeTracking) {
    clearInterval(entry.intervalId);
    console.log(`[TxTracker] Cancelled tracking for ${txHash}`);
  }
  activeTracking.clear();
}

/**
 * Get count of actively tracked transactions
 */
export function getActiveTrackingCount(): number {
  return activeTracking.size;
}

/**
 * Check if a transaction is being tracked
 */
export function isTracking(txHash: string): boolean {
  return activeTracking.has(txHash);
}
