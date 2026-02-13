import { test, expect } from '../../fixtures/wallet.fixture'

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
  await page.getByText('MetaMask').click()

  // ========================================
  // STEP 4: Handle MetaMask connection popup
  // ========================================
  // Use dappwright built-in method — handles MetaMask popup with correct selectors
  await wallet.approve()
  await page.waitForTimeout(2000)

  // ========================================
  // STEP 5: Verify connection via ethereum provider
  // ========================================
  await page.waitForTimeout(3000)
  const connected = await page.evaluate(() => {
    const eth = (window as any).ethereum
    return eth?.selectedAddress || eth?.accounts?.[0] || null
  })
  expect(connected?.toLowerCase()).toContain('0x')
})
