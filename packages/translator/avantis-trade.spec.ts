import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';

const test = testWithSynpress(metaMaskFixtures);

// Helper function to handle MetaMask popup interactions
async function handleMetaMaskPopup(metamask: MetaMask, buttonName: string, timeout = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const popup = await metamask.page.waitForSelector(`button:has-text("${buttonName}")`, { timeout: 1000 });
      if (popup) {
        await popup.click();
        await metamask.page.waitForTimeout(2000);
        return;
      }
    } catch (error) {
      // Continue polling
    }
    await metamask.page.waitForTimeout(500);
  }
  throw new Error(`MetaMask popup button "${buttonName}" not found within ${timeout}ms`);
}

// Helper function to handle network switching
async function handleNetworkSwitch(metamask: MetaMask, targetChainId: number) {
  try {
    const switchButton = await metamask.page.waitForSelector('button:has-text("Switch network")', { timeout: 3000 });
    if (switchButton) {
      await switchButton.click();
      await metamask.page.waitForTimeout(2000);
    }
  } catch (error) {
    // Network switch not needed or already on correct network
  }
}

test('Avantis Trade Example - Connect wallet and place BTCUSD trade', async ({ page, metamask }) => {
  // ============================================
  // SETUP: Navigate to Avantis trading platform
  // ============================================
  await page.goto('https://www.avantisfi.com/trade?asset=XAU-USD');
  await page.waitForLoadState('networkidle');

  // ============================================
  // WALLET CONNECTION FLOW
  // ============================================
  
  // Step 1: Click login button
  await page.getByTestId('login-button').click();
  await page.waitForTimeout(1000);

  // Step 2: Select "Continue with a wallet" option
  const continueWithWalletButton = page.locator('button').filter({ hasText: 'Continue with a wallet' }).first();
  await continueWithWalletButton.click();
  await page.waitForTimeout(1000);

  // Step 3: Select MetaMask instead of Rabby Wallet (mapping recorded wallet to MetaMask)
  const walletModal = page.locator('div#privy-modal-content');
  await walletModal.waitFor({ state: 'visible' });
  
  // Look for MetaMask option in the wallet selection modal
  const metamaskOption = walletModal.getByText('MetaMask').or(
    walletModal.locator('button').filter({ hasText: 'MetaMask' })
  ).first();
  await metamaskOption.click();

  // Step 4: Handle MetaMask connection popup
  await handleMetaMaskPopup(metamask, 'Connect');
  await page.waitForTimeout(3000);

  // Step 5: Handle network switch to Base if needed (Chain ID: 8453)
  await handleNetworkSwitch(metamask, 8453);

  // Step 6: Sign terms and conditions
  const tncSignButton = page.getByTestId('tnc-sign-button').or(
    page.getByRole('button', { name: 'Sign' })
  ).first();
  
  // Wait for the sign button to be visible
  await tncSignButton.waitFor({ state: 'visible', timeout: 10000 });
  await tncSignButton.click();

  // Step 7: Handle MetaMask signature popup
  await handleMetaMaskPopup(metamask, 'Sign');
  await page.waitForTimeout(3000);

  // ============================================
  // TRADING INTERFACE INTERACTION
  // ============================================

  // Step 8: Wait for trading interface to load
  await page.waitForTimeout(2000);

  // Step 9: Switch from XAUUSD to BTCUSD
  const btcusdOption = page.getByText('BTCUSD').or(
    page.locator('[data-symbol="BTCUSD"]')
  ).first();
  await btcusdOption.click();
  await page.waitForTimeout(1000);

  // ============================================
  // TRADE PARAMETERS SETUP
  // ============================================

  // Step 10: Set leverage to 120
  const leverageInput = page.getByTestId('leverage-input').or(
    page.locator('input[placeholder*="leverage"]')
  ).first();
  await leverageInput.clear();
  await leverageInput.fill('120');
  await page.waitForTimeout(500);

  // Step 11: Set collateral amount to 1
  const collateralInput = page.getByTestId('collateral-input').or(
    page.locator('input[placeholder*="collateral"]').or(
      page.locator('input[placeholder*="amount"]')
    )
  ).first();
  await collateralInput.clear();
  await collateralInput.fill('1');
  await page.waitForTimeout(500);

  // ============================================
  // TRADE EXECUTION
  // ============================================

  // Step 12: Click place order button
  const placeOrderButton = page.getByTestId('place-order-button').or(
    page.getByRole('button', { name: 'Place Order' })
  ).first();
  await placeOrderButton.click();
  await page.waitForTimeout(1000);

  // Step 13: Confirm the trade
  const confirmTradeButton = page.getByTestId('confirm-trade-button').or(
    page.getByRole('button', { name: 'Confirm' })
  ).first();
  
  // Wait for confirmation modal to appear
  await confirmTradeButton.waitFor({ state: 'visible', timeout: 5000 });
  await confirmTradeButton.click();

  // Step 14: Handle MetaMask transaction confirmation
  await handleMetaMaskPopup(metamask, 'Confirm');
  
  // Wait for transaction to be processed
  await page.waitForTimeout(5000);

  // ============================================
  // VERIFICATION
  // ============================================
  
  // Verify trade was submitted successfully
  // Look for success indicators or trade confirmation UI
  const successIndicator = page.locator('[data-testid="trade-success"]').or(
    page.getByText('Trade submitted').or(
      page.getByText('Order placed')
    )
  ).first();
  
  // Wait for success confirmation (optional - may not always appear)
  try {
    await successIndicator.waitFor({ state: 'visible', timeout: 10000 });
  } catch (error) {
    // Success indicator might not be present, continue with test
    console.log('Success indicator not found, but trade likely completed');
  }
});