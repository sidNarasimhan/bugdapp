import { test, expect, raceApprove } from '../../fixtures/wallet.fixture'

test('Connect wallet and trade on Avantis', async ({ wallet, page }) => {
  // ========================================
  // STEP 1: Navigate to Avantis trade page
  // ========================================
  await page.goto('https://www.avantisfi.com/trade?asset=BTC-USD')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3000)

  // ========================================
  // STEP 2: Login flow (Privy authentication)
  // ========================================
  // Click the Login button
  await page.getByTestId('login-button')
    .or(page.locator('[data-testid="login-button"]'))
    .first()
    .click()
  await page.waitForTimeout(2000)

  // Click "Continue with a wallet" in Privy modal
  await page.getByRole('button', { name: 'Continue with a wallet' })
    .or(page.locator('button:has-text("Continue with a wallet")'))
    .or(page.locator('button:nth-child(7) div:nth-child(2)'))
    .first()
    .click()
  await page.waitForTimeout(2000)

  // Select MetaMask (instead of Rabby from recording)
  await page.getByRole('button', { name: 'MetaMask' })
    .or(page.locator('button:has-text("MetaMask")'))
    .or(page.locator('div#privy-modal-content button:nth-child(2) span:nth-child(2)'))
    .first()
    .click()

  // ========================================
  // STEP 3: Race-safe approve + auto SIWE
  // ========================================
  await raceApprove(wallet, page.context(), page)

  // ========================================
  // STEP 4: Verify SIWE completed (dApp UI check)
  // ========================================
  // Login button should disappear when fully authenticated
  await expect(page.getByTestId('login-button')
    .or(page.getByRole('button', { name: /login/i }))
    .first()).not.toBeVisible({ timeout: 15000 })

  // ========================================
  // STEP 5: Switch to Base network
  // ========================================
  await wallet.switchNetwork('Base')
  await page.bringToFront()
  await page.waitForTimeout(5000)

  const chainId = await page.evaluate(() => (window as any).ethereum?.chainId)
  expect(chainId).toBeTruthy()
})
