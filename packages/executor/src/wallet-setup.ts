import type { BrowserContext } from '@playwright/test';

/**
 * Wallet setup utilities for MetaMask in Playwright tests
 */

export interface WalletConfig {
  seedPhrase: string;
  password: string;
  network?: {
    chainId: number;
    name: string;
    rpcUrl: string;
    symbol: string;
  };
}

/**
 * Default test wallet configuration
 * Uses Synpress's default test wallet
 */
export const DEFAULT_WALLET_CONFIG: WalletConfig = {
  seedPhrase: 'test test test test test test test test test test test junk',
  password: 'TestPassword123',
};

/**
 * Initialize MetaMask with a wallet
 *
 * Note: In production, this is typically handled by Synpress's wallet caching.
 * This is for cases where manual setup is needed.
 */
export async function initializeWallet(
  context: BrowserContext,
  config: WalletConfig = DEFAULT_WALLET_CONFIG
): Promise<boolean> {
  // Find MetaMask onboarding page
  const pages = context.pages();

  for (const page of pages) {
    const url = page.url();

    if (url.includes('chrome-extension://') && url.includes('home.html')) {
      // MetaMask home page - check if already initialized
      const isInitialized = await page.evaluate(() => {
        // Check for unlock screen or account screen
        return document.querySelector('[data-testid="unlock-page"]') !== null ||
               document.querySelector('[data-testid="account-menu-icon"]') !== null;
      });

      if (isInitialized) {
        console.log('[Wallet] MetaMask already initialized');
        return true;
      }
    }

    if (url.includes('chrome-extension://') && url.includes('onboarding')) {
      // MetaMask onboarding page
      console.log('[Wallet] Starting MetaMask onboarding...');

      try {
        // Import existing wallet
        await page.getByTestId('onboarding-import-wallet').click();
        await page.waitForTimeout(500);

        // Agree to terms
        await page.getByTestId('onboarding-terms-checkbox').click();
        await page.getByTestId('onboarding-import-wallet').click();
        await page.waitForTimeout(500);

        // Enter seed phrase
        const words = config.seedPhrase.split(' ');
        for (let i = 0; i < words.length; i++) {
          await page.fill(`[data-testid="import-srp__srp-word-${i}"]`, words[i]);
        }

        await page.getByTestId('import-srp-confirm').click();
        await page.waitForTimeout(500);

        // Set password
        await page.fill('[data-testid="create-password-new"]', config.password);
        await page.fill('[data-testid="create-password-confirm"]', config.password);
        await page.getByTestId('create-password-terms').click();
        await page.getByTestId('create-password-import').click();
        await page.waitForTimeout(1000);

        // Complete setup
        await page.getByTestId('onboarding-complete-done').click();
        await page.waitForTimeout(500);

        // Skip what's new
        try {
          await page.getByTestId('pin-extension-next').click();
          await page.getByTestId('pin-extension-done').click();
        } catch {
          // Optional steps, may not appear
        }

        console.log('[Wallet] MetaMask initialized successfully');
        return true;
      } catch (error) {
        console.error('[Wallet] Failed to initialize MetaMask:', error);
        return false;
      }
    }
  }

  console.log('[Wallet] MetaMask page not found');
  return false;
}

/**
 * Unlock MetaMask if locked
 */
export async function unlockWallet(
  context: BrowserContext,
  password: string = DEFAULT_WALLET_CONFIG.password
): Promise<boolean> {
  const pages = context.pages();

  for (const page of pages) {
    const url = page.url();

    if (url.includes('chrome-extension://') && url.includes('home.html')) {
      // Check for unlock page
      const unlockInput = page.getByTestId('unlock-password');

      if (await unlockInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await unlockInput.fill(password);
        await page.getByTestId('unlock-submit').click();
        await page.waitForTimeout(1000);
        console.log('[Wallet] MetaMask unlocked');
        return true;
      }

      // Already unlocked
      console.log('[Wallet] MetaMask already unlocked');
      return true;
    }
  }

  return false;
}

/**
 * Add a custom network to MetaMask
 */
export async function addNetwork(
  context: BrowserContext,
  network: NonNullable<WalletConfig['network']>
): Promise<boolean> {
  const pages = context.pages();

  for (const page of pages) {
    const url = page.url();

    if (url.includes('chrome-extension://') && url.includes('home.html')) {
      try {
        // Open network settings
        await page.getByTestId('network-display').click();
        await page.waitForTimeout(500);

        // Check if network already exists
        const networkItem = page.getByText(network.name);
        if (await networkItem.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log(`[Wallet] Network ${network.name} already exists`);
          await page.keyboard.press('Escape');
          return true;
        }

        // Add network
        await page.getByTestId('add-network-button').click();
        await page.waitForTimeout(500);

        // Fill network details
        await page.fill('[data-testid="network-form-network-name"]', network.name);
        await page.fill('[data-testid="network-form-rpc-url"]', network.rpcUrl);
        await page.fill('[data-testid="network-form-chain-id"]', network.chainId.toString());
        await page.fill('[data-testid="network-form-ticker-input"]', network.symbol);

        await page.getByTestId('add-network-form-submit').click();
        await page.waitForTimeout(1000);

        console.log(`[Wallet] Added network: ${network.name}`);
        return true;
      } catch (error) {
        console.error('[Wallet] Failed to add network:', error);
        return false;
      }
    }
  }

  return false;
}

/**
 * Switch to a network in MetaMask
 */
export async function switchNetwork(
  context: BrowserContext,
  networkName: string
): Promise<boolean> {
  const pages = context.pages();

  for (const page of pages) {
    const url = page.url();

    if (url.includes('chrome-extension://') && url.includes('home.html')) {
      try {
        await page.getByTestId('network-display').click();
        await page.waitForTimeout(500);

        const networkItem = page.getByText(networkName);
        if (await networkItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await networkItem.click();
          await page.waitForTimeout(1000);
          console.log(`[Wallet] Switched to network: ${networkName}`);
          return true;
        }

        console.log(`[Wallet] Network not found: ${networkName}`);
        await page.keyboard.press('Escape');
        return false;
      } catch (error) {
        console.error('[Wallet] Failed to switch network:', error);
        return false;
      }
    }
  }

  return false;
}

/**
 * Get connected account address
 */
export async function getAccountAddress(context: BrowserContext): Promise<string | null> {
  const pages = context.pages();

  for (const page of pages) {
    const url = page.url();

    if (url.includes('chrome-extension://') && url.includes('home.html')) {
      try {
        await page.getByTestId('account-menu-icon').click();
        await page.waitForTimeout(500);

        // Get the address from the account menu
        const addressElement = page.locator('[data-testid="selected-account-address"]');
        const address = await addressElement.textContent();

        await page.keyboard.press('Escape');
        return address;
      } catch {
        return null;
      }
    }
  }

  return null;
}
