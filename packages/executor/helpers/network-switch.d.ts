import type { BrowserContext, Page } from '@playwright/test';
/**
 * Network switch helpers for dApp testing
 */
export interface NetworkConfig {
    chainId: number;
    chainIdHex: string;
    name: string;
    rpcUrl: string;
    symbol: string;
    blockExplorer?: string;
}
export declare const NETWORKS: Record<string, NetworkConfig>;
/**
 * Look for network switch buttons in dApp UI and handle them
 */
export declare function handleDAppNetworkSwitch(page: Page, context: BrowserContext, targetNetwork?: string): Promise<boolean>;
/**
 * Switch network programmatically via MetaMask
 */
export declare function switchNetworkViaMetaMask(page: Page, context: BrowserContext, network: NetworkConfig): Promise<boolean>;
/**
 * Verify current network matches expected
 */
export declare function verifyNetwork(page: Page, expectedChainId: number): Promise<boolean>;
/**
 * Wait for network to be connected
 */
export declare function waitForNetworkConnection(page: Page, timeout?: number): Promise<boolean>;
//# sourceMappingURL=network-switch.d.ts.map