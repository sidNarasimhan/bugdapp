/**
 * Basic wallet connection test using dappwright.
 *
 * Connects MetaMask to the official MetaMask Test Dapp
 * (https://metamask.github.io/test-dapp/) and verifies
 * the connection succeeded by checking the accounts display.
 *
 * This is the equivalent of synpress-test/test/playwright/metamask-test-dapp.spec.ts
 * but using dappwright instead of Synpress.
 */

import { test, expect } from '../../fixtures/wallet.fixture';

test.describe('MetaMask Test Dapp - Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://metamask.github.io/test-dapp/');
    await page.waitForLoadState('domcontentloaded');
    // Give MetaMask content script time to inject window.ethereum
    await page.waitForTimeout(2000);
  });

  test('should have MetaMask injected', async ({ page }) => {
    const state = await page.evaluate(() => {
      const eth = (window as any).ethereum;
      return {
        exists: !!eth,
        isMetaMask: eth?.isMetaMask,
        chainId: eth?.chainId,
        initialized: eth?._state?.initialized,
      };
    });

    console.log('Ethereum state:', JSON.stringify(state, null, 2));

    expect(state.exists).toBe(true);
    expect(state.isMetaMask).toBe(true);
    expect(state.initialized).toBe(true);
  });

  test('should connect wallet to dApp', async ({ wallet, page }) => {
    // Click the dApp's connect button
    await page.locator('#connectButton').click();
    console.log('Clicked connect button on dApp');

    // dappwright handles the MetaMask popup automatically
    // approve() waits for the MetaMask popup page, clicks the confirm button, and waits for it to close
    await wallet.approve();
    console.log('Approved connection in MetaMask via dappwright');

    // Verify connection - the official test dapp displays the connected account
    const accounts = page.locator('#accounts');
    await expect(accounts).not.toBeEmpty();

    const accountText = await accounts.textContent();
    console.log(`Connected account: ${accountText}`);

    // The Hardhat default seed phrase produces this address
    expect(accountText?.toLowerCase()).toContain(
      '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
    );
  });

  test('should reject connection', async ({ wallet, page }) => {
    // Navigate to a fresh page to ensure we're not already connected
    await page.goto('about:blank');
    await page.goto('https://metamask.github.io/test-dapp/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Only attempt if the connect button is enabled (not already connected)
    const connectBtn = page.locator('#connectButton');
    const isDisabled = await connectBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      console.log('Wallet already connected from previous test — skipping reject test');
      return;
    }

    // Click connect on the dApp
    await connectBtn.click();

    // Use wallet.reject() to deny the connection request
    await wallet.reject();
    console.log('Rejected connection in MetaMask');

    // The accounts element should remain empty or show no connection
    const accounts = page.locator('#accounts');
    await expect(accounts).toHaveText('');
  });
});
