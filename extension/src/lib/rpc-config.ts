/**
 * Chain-specific RPC configuration for transaction receipt polling
 * Uses public RPC endpoints for MVP (production should migrate to Alchemy/Infura)
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  blockExplorerUrl: string;
}

/**
 * Supported chain configurations
 * Public RPC endpoints with reasonable reliability
 */
export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // Ethereum Mainnet
  1: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    blockExplorerUrl: 'https://etherscan.io',
  },
  // Arbitrum One
  42161: {
    chainId: 42161,
    name: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockExplorerUrl: 'https://arbiscan.io',
  },
  // Optimism
  10: {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    blockExplorerUrl: 'https://optimistic.etherscan.io',
  },
  // Base
  8453: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorerUrl: 'https://basescan.org',
  },
  // Polygon
  137: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    blockExplorerUrl: 'https://polygonscan.com',
  },
  // Sepolia Testnet
  11155111: {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrl: 'https://rpc.sepolia.org',
    blockExplorerUrl: 'https://sepolia.etherscan.io',
  },
  // Goerli Testnet (deprecated but still used)
  5: {
    chainId: 5,
    name: 'Goerli',
    rpcUrl: 'https://rpc.goerli.mudit.blog',
    blockExplorerUrl: 'https://goerli.etherscan.io',
  },
};

/**
 * Get RPC URL for a chain
 * Returns undefined if chain not supported
 */
export function getRpcUrl(chainId: number): string | undefined {
  return CHAIN_CONFIGS[chainId]?.rpcUrl;
}

/**
 * Get full chain configuration
 * Returns undefined if chain not supported
 */
export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAIN_CONFIGS[chainId];
}

/**
 * Get human-readable chain name
 * Returns "Unknown Chain" if not supported
 */
export function getChainName(chainId: number): string {
  return CHAIN_CONFIGS[chainId]?.name ?? `Unknown Chain (${chainId})`;
}

/**
 * Get list of all supported chain IDs
 */
export function getSupportedChainIds(): number[] {
  return Object.keys(CHAIN_CONFIGS).map(Number);
}

/**
 * Check if a chain is supported
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in CHAIN_CONFIGS;
}
