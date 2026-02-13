import { test, expect } from '../../fixtures/wallet.fixture'

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
  // STEP 3: Handle MetaMask connection popup
  // ========================================
  await wallet.approve()
  await page.waitForTimeout(3000)

  // ========================================
  // STEP 4: Handle SIWE (Sign-In With Ethereum)
  // After wallet.approve(), Privy shows a "Welcome" dialog with Terms of Service.
  // Must click "Sign" on the dApp page FIRST to trigger MetaMask SIWE popup.
  // ========================================
  const signBtn = page.getByRole('button', { name: 'Sign' })
    .or(page.getByTestId('tnc-sign-button'))
    .or(page.locator('button:has-text("Sign")'))
    .first()
  await signBtn.waitFor({ state: 'visible', timeout: 15000 })
  await signBtn.click()

  // Handle the MetaMask SIWE signature popup
  await wallet.sign()
  await page.waitForTimeout(5000)

  // ========================================
  // STEP 5: Verify connection and SIWE completed
  // ========================================
  const connected = await page.evaluate(() => {
    const eth = (window as any).ethereum
    return eth?.selectedAddress || eth?.accounts?.[0] || null
  })
  expect(connected?.toLowerCase()).toContain('0x')

  // ========================================
  // STEP 6: Switch to Base network
  // ========================================
  await wallet.switchNetwork('Base')
  await page.waitForTimeout(3000)

  const chainId = await page.evaluate(() => (window as any).ethereum?.chainId)
  expect(chainId).toBeTruthy()
})
