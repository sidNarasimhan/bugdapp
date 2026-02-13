/**
 * Global type declarations for window.ethereum and EIP-6963 providers
 */

/**
 * EIP-1193: Ethereum Provider JavaScript API
 */
interface EthereumProvider {
  // Required EIP-1193 method
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;

  // Events
  on?(event: string, callback: (...args: unknown[]) => void): void;
  removeListener?(event: string, callback: (...args: unknown[]) => void): void;

  // Connection state
  isConnected?(): boolean;
  selectedAddress?: string | null;
  chainId?: string;

  // Provider identification
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isBraveWallet?: boolean;
  isPhantom?: boolean;

  // Allow any other properties
  [key: string]: unknown;
}

/**
 * EIP-6963: Provider information for wallet discovery
 */
interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

/**
 * EIP-6963: Provider detail containing info and provider
 */
interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
}

/**
 * EIP-6963: Custom event for provider announcement
 */
interface EIP6963AnnounceProviderEvent extends CustomEvent {
  type: 'eip6963:announceProvider';
  detail: EIP6963ProviderDetail;
}

/**
 * Window augmentation
 */
interface Window {
  ethereum?: EthereumProvider;
  __web3TestRecorder?: {
    startRecording: (sessionId: string) => void;
    stopRecording: () => void;
    isRecording: () => boolean;
    sessionId?: () => string | null;
  };
}

/**
 * Global event map augmentation for EIP-6963 events
 */
interface WindowEventMap {
  'eip6963:announceProvider': EIP6963AnnounceProviderEvent;
  'eip6963:requestProvider': Event;
}
