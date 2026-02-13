import type { BrowserContext, Page } from '@playwright/test';
import { handleMetaMaskPopup, handleNetworkSwitch } from './metamask-popup.js';

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

// Common network configurations
export const NETWORKS: Record<string, NetworkConfig> = {
  ethereum: {
    chainId: 1,
    chainIdHex: '0x1',
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth.llamarpc.com',
    symbol: 'ETH',
    blockExplorer: 'https://etherscan.io',
  },
  base: {
    chainId: 8453,
    chainIdHex: '0x2105',
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    symbol: 'ETH',
    blockExplorer: 'https://basescan.org',
  },
  arbitrum: {
    chainId: 42161,
    chainIdHex: '0xa4b1',
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    symbol: 'ETH',
    blockExplorer: 'https://arbiscan.io',
  },
  optimism: {
    chainId: 10,
    chainIdHex: '0xa',
    name: 'Optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    symbol: 'ETH',
    blockExplorer: 'https://optimistic.etherscan.io',
  },
  polygon: {
    chainId: 137,
    chainIdHex: '0x89',
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    symbol: 'MATIC',
    blockExplorer: 'https://polygonscan.com',
  },
};

/**
 * Look for network switch buttons in dApp UI and handle them
 */
export async function handleDAppNetworkSwitch(
  page: Page,
  context: BrowserContext,
  targetNetwork?: string
): Promise<boolean> {
  // Common selectors for network switch buttons in dApps
  const networkSwitchSelectors = [
    page.getByRole('button', { name: /switch to/i }),
    page.getByRole('button', { name: /wrong network/i }),
    page.getByRole('button', { name: /switch network/i }),
    page.getByRole('button', { name: /change network/i }),
    page.getByText(/switch to/i),
    page.getByText(/wrong network/i),
    page.locator('[data-testid="network-switch"]'),
    page.locator('[data-testid="switch-network"]'),
    page.locator('[data-testid="wrong-network"]'),
  ];

  // If we have a target network, also try looking for it specifically
  if (targetNetwork) {
    networkSwitchSelectors.push(
      page.getByRole('button', { name: new RegExp(targetNetwork, 'i') }),
      page.locator(`button:has-text("${targetNetwork}")`),
    );
  }

  // Try each selector
  for (const selector of networkSwitchSelectors) {
    try {
      if (await selector.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('[Network] Found network switch button, clicking...');
        await selector.first().click();
        await page.waitForTimeout(1000);

        // Handle MetaMask network approval popup
        const approved = await handleMetaMaskPopup(
          context,
          /approve|confirm|switch/i,
          { timeout: 10000 }
        );

        if (approved) {
          await page.waitForTimeout(3000);
          return true;
        }
      }
    } catch {
      // Continue to next selector
    }
  }

  // Also try generic MetaMask network switch popup
  return handleNetworkSwitch(context, { timeout: 5000 });
}

/**
 * Switch network programmatically via MetaMask
 */
export async function switchNetworkViaMetaMask(
  page: Page,
  context: BrowserContext,
  network: NetworkConfig
): Promise<boolean> {
  // This would need to interact with MetaMask's network settings
  // For now, we rely on dApp-triggered switches
  console.log(`[Network] Attempting to switch to ${network.name}`);

  // Trigger network switch via dApp if possible
  const switched = await handleDAppNetworkSwitch(page, context, network.name);

  return switched;
}

/**
 * Verify current network matches expected
 */
export async function verifyNetwork(
  page: Page,
  expectedChainId: number
): Promise<boolean> {
  try {
    // Try to get chain ID from page via ethereum provider
    const currentChainId = await page.evaluate(async () => {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const chainId = await (window as any).ethereum.request({
          method: 'eth_chainId',
        });
        return parseInt(chainId, 16);
      }
      return null;
    });

    return currentChainId === expectedChainId;
  } catch {
    return false;
  }
}

/**
 * Wait for network to be connected
 */
export async function waitForNetworkConnection(
  page: Page,
  timeout = 10000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const isConnected = await page.evaluate(async () => {
        if (typeof window !== 'undefined' && (window as any).ethereum) {
          const accounts = await (window as any).ethereum.request({
            method: 'eth_accounts',
          });
          return accounts && accounts.length > 0;
        }
        return false;
      });

      if (isConnected) {
        return true;
      }
    } catch {
      // Continue polling
    }

    await new Promise(r => setTimeout(r, 500));
  }

  return false;
}
