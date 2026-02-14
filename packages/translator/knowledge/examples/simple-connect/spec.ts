import { test, expect, raceApprove } from '../../fixtures/wallet.fixture'

test('Connect wallet to dApp', async ({ wallet, page }) => {
  // ========================================
  // STEP 1: Navigate to dApp
  // ========================================
  await page.goto('https://example-dapp.com')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2000)

  // ========================================
  // STEP 2: Click Connect Wallet button
  // ========================================
  const connectButton = page.getByTestId('connect-wallet-button')
  await connectButton.click()
  await page.waitForTimeout(1000)

  // ========================================
  // STEP 3: Select MetaMask from wallet options
  // ========================================
  await page.getByRole('button', { name: /metamask/i })
    .or(page.locator('button:has-text("MetaMask")'))
    .first()
    .click()

  // ========================================
  // STEP 4: Race-safe approve (handles popups + auto SIWE)
  // ========================================
  await raceApprove(wallet, page.context(), page)

  // ========================================
  // STEP 5: Verify connection via dApp UI
  // ========================================
  // Check that connect button is gone (proves full auth completed)
  await expect(page.getByTestId('connect-wallet-button')).not.toBeVisible({ timeout: 15000 })
})
