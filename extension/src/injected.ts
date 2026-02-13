/**
 * Injected script for Web3 provider interception
 * Runs in main world (page context) to access window.ethereum
 *
 * Communication:
 * - Receives: SET_RECORDING messages from content script
 * - Sends: WEB3_REQUEST/WEB3_RESPONSE messages to content script
 */

// Recording state - controlled by content script messages
let isRecording = false;

// Track if we've already wrapped ethereum
let isWrapped = false;

// Original ethereum provider reference
let originalEthereum: EthereumProvider | null = null;

// EIP-6963 providers we've wrapped
const wrappedProviders = new WeakSet<EthereumProvider>();

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  [key: string]: unknown;
}

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
}

interface Web3RequestMessage {
  type: 'WEB3_REQUEST';
  id: string;
  method: string;
  params: unknown;
  timestamp: number;
  providerInfo?: EIP6963ProviderInfo;
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
 * Generate unique ID for request/response correlation
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Send message to content script
 */
function sendToContentScript(message: Web3RequestMessage | Web3ResponseMessage): void {
  window.postMessage(message, '*');
}

/**
 * Create a proxy wrapper for an Ethereum provider
 */
function wrapProvider(
  provider: EthereumProvider,
  providerInfo?: EIP6963ProviderInfo
): EthereumProvider {
  // Already wrapped - return as is
  if (wrappedProviders.has(provider)) {
    return provider;
  }

  const originalRequest = provider.request.bind(provider);

  const wrappedProvider = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'request') {
        return async (args: { method: string; params?: unknown[] }): Promise<unknown> => {
          const requestId = generateId();
          const { method, params } = args;

          // Send request event if recording
          if (isRecording) {
            sendToContentScript({
              type: 'WEB3_REQUEST',
              id: requestId,
              method,
              params,
              timestamp: Date.now(),
              providerInfo,
            });
          }

          try {
            // Call original provider
            const result = await originalRequest(args);

            // Send response event if recording
            if (isRecording) {
              sendToContentScript({
                type: 'WEB3_RESPONSE',
                id: requestId,
                method,
                result,
                timestamp: Date.now(),
              });
            }

            return result;
          } catch (error) {
            // Send error response if recording
            if (isRecording) {
              sendToContentScript({
                type: 'WEB3_RESPONSE',
                id: requestId,
                method,
                error: {
                  message: error instanceof Error ? error.message : String(error),
                  code: (error as { code?: number })?.code,
                },
                timestamp: Date.now(),
              });
            }

            throw error;
          }
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });

  wrappedProviders.add(wrappedProvider);
  return wrappedProvider;
}

/**
 * Wrap window.ethereum by patching its request method directly
 * This works even when window.ethereum is non-configurable (Rabby, MetaMask, etc.)
 */
function wrapWindowEthereum(): void {
  if (isWrapped || typeof window.ethereum === 'undefined') {
    return;
  }

  const ethereum = window.ethereum;

  // Check if request method exists
  if (typeof ethereum.request !== 'function') {
    console.warn('[Web3Recorder] window.ethereum.request is not a function');
    return;
  }

  // Store original request method
  const originalRequest = ethereum.request.bind(ethereum);

  // Patch the request method directly (don't try to redefine window.ethereum)
  try {
    ethereum.request = async function(args: { method: string; params?: unknown[] }): Promise<unknown> {
      const requestId = generateId();
      const { method, params } = args;

      console.log('[Web3Recorder] Intercepted:', method, isRecording ? '(RECORDING)' : '');

      // Send request event if recording
      if (isRecording) {
        sendToContentScript({
          type: 'WEB3_REQUEST',
          id: requestId,
          method,
          params,
          timestamp: Date.now(),
        });
      }

      try {
        const result = await originalRequest(args);

        console.log('[Web3Recorder] Result:', method, result ? 'OK' : 'empty');

        // Send response event if recording
        if (isRecording) {
          sendToContentScript({
            type: 'WEB3_RESPONSE',
            id: requestId,
            method,
            result,
            timestamp: Date.now(),
          });
        }

        return result;
      } catch (error) {
        console.log('[Web3Recorder] Error:', method, error);

        if (isRecording) {
          sendToContentScript({
            type: 'WEB3_RESPONSE',
            id: requestId,
            method,
            error: {
              message: error instanceof Error ? error.message : String(error),
              code: (error as { code?: number })?.code,
            },
            timestamp: Date.now(),
          });
        }

        throw error;
      }
    };

    isWrapped = true;
    console.log('[Web3Recorder] window.ethereum.request patched successfully');
  } catch (error) {
    console.error('[Web3Recorder] Failed to patch window.ethereum.request:', error);
  }
}

// Track which EIP-6963 providers we've already patched
const patchedEIP6963Providers = new WeakSet<EthereumProvider>();

/**
 * Handle EIP-6963 provider announcement events
 * Patch the provider's request method directly (don't try to modify the event)
 */
function handleEIP6963Announce(event: CustomEvent<EIP6963ProviderDetail>): void {
  const { info, provider } = event.detail;

  if (!provider || typeof provider.request !== 'function') {
    return;
  }

  // Skip if already patched
  if (patchedEIP6963Providers.has(provider)) {
    console.log('[Web3Recorder] EIP-6963 provider already patched:', info.name);
    return;
  }

  // Patch the request method directly
  try {
    const originalRequest = provider.request.bind(provider);

    provider.request = async function(args: { method: string; params?: unknown[] }): Promise<unknown> {
      const requestId = generateId();
      const { method, params } = args;

      console.log('[Web3Recorder] EIP-6963 Intercepted:', info.name, method, isRecording ? '(RECORDING)' : '');

      if (isRecording) {
        sendToContentScript({
          type: 'WEB3_REQUEST',
          id: requestId,
          method,
          params,
          timestamp: Date.now(),
          providerInfo: info,
        });
      }

      try {
        const result = await originalRequest(args);

        if (isRecording) {
          sendToContentScript({
            type: 'WEB3_RESPONSE',
            id: requestId,
            method,
            result,
            timestamp: Date.now(),
          });
        }

        return result;
      } catch (error) {
        if (isRecording) {
          sendToContentScript({
            type: 'WEB3_RESPONSE',
            id: requestId,
            method,
            error: {
              message: error instanceof Error ? error.message : String(error),
              code: (error as { code?: number })?.code,
            },
            timestamp: Date.now(),
          });
        }
        throw error;
      }
    };

    patchedEIP6963Providers.add(provider);
    console.log('[Web3Recorder] EIP-6963 provider patched:', info.name);
  } catch (error) {
    console.error('[Web3Recorder] Failed to patch EIP-6963 provider:', info.name, error);
  }
}

/**
 * Set up EIP-6963 listener
 */
function setupEIP6963Listener(): void {
  window.addEventListener('eip6963:announceProvider', handleEIP6963Announce as EventListener);

  // Request providers in case some have already announced
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  console.log('[Web3Recorder] EIP-6963 listener active');
}

/**
 * Poll for late window.ethereum injection
 * Some wallet extensions inject after our script runs
 */
function pollForEthereum(): void {
  if (isWrapped) {
    return;
  }

  let attempts = 0;
  const maxAttempts = 50; // 5 seconds total
  const interval = 100;

  const poll = setInterval(() => {
    attempts++;

    if (typeof window.ethereum !== 'undefined') {
      wrapWindowEthereum();
      clearInterval(poll);
      console.log('[Web3Recorder] window.ethereum found after', attempts * interval, 'ms');
    } else if (attempts >= maxAttempts) {
      clearInterval(poll);
      console.log('[Web3Recorder] window.ethereum not found after polling');
    }
  }, interval);
}

/**
 * Listen for recording state messages from content script
 */
function setupMessageListener(): void {
  window.addEventListener('message', (event) => {
    // Only accept messages from same window
    if (event.source !== window) {
      return;
    }

    const message = event.data;

    if (message?.type === 'SET_RECORDING') {
      isRecording = message.isRecording;
      console.log('[Web3Recorder] Recording state:', isRecording ? 'ON' : 'OFF');
    }
  });
}

/**
 * Initialize Web3 interception
 */
function init(): void {
  console.log('[Web3Recorder] ====== INJECTED SCRIPT STARTING ======');
  console.log('[Web3Recorder] URL:', window.location.href);
  console.log('[Web3Recorder] window.ethereum exists:', typeof window.ethereum !== 'undefined');

  if (typeof window.ethereum !== 'undefined') {
    console.log('[Web3Recorder] window.ethereum type:', typeof window.ethereum);
    console.log('[Web3Recorder] window.ethereum.isMetaMask:', (window.ethereum as any)?.isMetaMask);
    console.log('[Web3Recorder] window.ethereum.isRabby:', (window.ethereum as any)?.isRabby);
    console.log('[Web3Recorder] window.ethereum.isCoinbaseWallet:', (window.ethereum as any)?.isCoinbaseWallet);
  }

  // Set up message listener first
  setupMessageListener();

  // Try to wrap immediately if ethereum exists
  if (typeof window.ethereum !== 'undefined') {
    console.log('[Web3Recorder] Wrapping existing window.ethereum...');
    wrapWindowEthereum();
  } else {
    console.log('[Web3Recorder] window.ethereum not found, polling...');
    // Poll for late injection
    pollForEthereum();
  }

  // Set up EIP-6963 listener for modern wallet discovery
  setupEIP6963Listener();

  console.log('[Web3Recorder] ====== INJECTED SCRIPT READY ======');
}

// Initialize immediately when script loads
console.log('[Web3Recorder] Script loaded, calling init()...');
init();
