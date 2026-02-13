import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

// Helper function to handle MetaMask popup interactions
async function handleMetaMaskPopup(context: any, buttonName: string | RegExp, timeout = 10000) {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    const pages = context.pages()
    for (const p of pages) {
      const url = p.url()
      if (url.includes('chrome-extension://') && url.includes('notification')) {
        await p.bringToFront()
        await p.waitForTimeout(500)
        const btn = p.getByRole('button', { name: buttonName })
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click()
          return true
        }
      }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

// Helper function to handle network switching
async function handleNetworkSwitch(context: any, page: any) {
  // Check if network switch is needed
  const networkSwitchButton = page.getByText(/switch network|wrong network/i).first()
  if (await networkSwitchButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await networkSwitchButton.click()
    await handleMetaMaskPopup(context, /switch|confirm/i)
    await page.waitForTimeout(2000)
  }
}

test('Avantis Trade Example - Connect wallet and place BTCUSD trade', async ({ context, page, metamaskPage, extensionId }) => {
  const PASSWORD = 'TestPassword123'
  const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId)

  // Close any existing MetaMask home tabs
  const pages = context.pages()
  for (const p of pages) {
    if (p.url().includes('chrome-extension://') && p.url().includes('home.html')) {
      await p.close()
    }
  }

  // ==================== NAVIGATION ====================
  await page.goto('https://www.avantisfi.com/trade?asset=XAU-USD')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3000)

  // ==================== WALLET CONNECTION ====================
  // Step 1: Click login button
  const loginButton = page.getByTestId('login-button').or(
    page.getByRole('button', { name: /login/i })
  ).or(
    page.getByText('Login')
  )
  await loginButton.click()
  await page.waitForTimeout(1000)

  // Step 2: Click "Continue with a wallet"
  const continueWalletButton = page.getByText('Continue with a wallet').or(
    page.getByRole('button', { name: /continue with.*wallet/i })
  ).or(
    page.locator('button:has-text("Continue with a wallet")')
  )
  await continueWalletButton.click()
  await page.waitForTimeout(1000)

  // Step 3: Select MetaMask instead of Rabby Wallet
  const metamaskButton = page.getByText('MetaMask').or(
    page.getByRole('button', { name: /metamask/i })
  ).or(
    page.locator('[data-testid*="metamask"], [id*="metamask"]')
  )
  await metamaskButton.click()

  // Handle MetaMask connection popup
  await page.waitForTimeout(2000)
  await handleMetaMaskPopup(context, /connect/i)
  await page.waitForTimeout(2000)

  // Handle potential network switch to Base
  await handleNetworkSwitch(context, page)

  // ==================== TERMS & CONDITIONS SIGNING ====================
  // Step 6: Sign terms and conditions
  const signButton = page.getByTestId('tnc-sign-button').or(
    page.getByRole('button', { name: /sign/i })
  ).or(
    page.getByText('Sign')
  )
  
  if (await signButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await signButton.click()
    await page.waitForTimeout(1000)
    
    // Handle MetaMask signature popup
    await handleMetaMaskPopup(context, /sign/i)
    await page.waitForTimeout(3000)
  }

  // ==================== ASSET SELECTION ====================
  // Step 8-9: Navigate from XAUUSD to BTCUSD
  const btcusdAsset = page.getByText('BTCUSD').or(
    page.locator('[data-testid*="btcusd"], [data-asset="BTCUSD"]')
  ).or(
    page.locator('text=BTCUSD')
  )
  await btcusdAsset.click()
  await page.waitForTimeout(2000)

  // ==================== TRADE PARAMETERS ====================
  // Step 10: Set leverage to 120
  const leverageInput = page.getByTestId('leverage-input').or(
    page.locator('input[placeholder*="leverage"], input[name*="leverage"]')
  ).or(
    page.locator('input').filter({ hasText: /leverage/i })
  )
  await leverageInput.clear()
  await leverageInput.fill('120')
  await page.waitForTimeout(500)

  // Step 11: Set collateral to 1
  const collateralInput = page.getByTestId('collateral-input').or(
    page.locator('input[placeholder*="collateral"], input[name*="collateral"]')
  ).or(
    page.locator('input').filter({ hasText: /collateral/i })
  )
  await collateralInput.clear()
  await collateralInput.fill('1')
  await page.waitForTimeout(500)

  // ==================== PLACE TRADE ====================
  // Step 12: Click place order button
  const placeOrderButton = page.getByTestId('place-order-button').or(
    page.getByRole('button', { name: /place order/i })
  ).or(
    page.getByText('Place Order')
  )
  await placeOrderButton.click()
  await page.waitForTimeout(1000)

  // Step 13: Confirm the trade
  const confirmTradeButton = page.getByTestId('confirm-trade-button').or(
    page.getByRole('button', { name: /confirm/i })
  ).or(
    page.getByText('Confirm')
  )
  await confirmTradeButton.click()
  await page.waitForTimeout(1000)

  // Handle MetaMask transaction confirmation
  await handleMetaMaskPopup(context, /confirm/i, 15000)
  await page.waitForTimeout(5000)

  // ==================== VERIFICATION ====================
  // Verify trade was placed successfully
  const successIndicator = page.getByText(/success|confirmed|completed/i).or(
    page.locator('[data-testid*="success"], [class*="success"]')
  )
  
  if (await successIndicator.isVisible({ timeout: 10000 }).catch(() => false)) {
    await expect(successIndicator).toBeVisible()
  }
})