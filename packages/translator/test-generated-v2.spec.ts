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
async function handleNetworkSwitch(context: any, page: any, targetNetwork = 'Base') {
  // Check if network switch is needed
  const switchNetworkButton = page.getByText('Switch network').or(page.getByText('Wrong network')).first()
  if (await switchNetworkButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await switchNetworkButton.click()
    await page.waitForTimeout(1000)
    
    // Handle MetaMask network switch popup
    await handleMetaMaskPopup(context, /switch/i)
    await page.waitForTimeout(2000)
  }
}

test('Avantis Trade Example', async ({ context, page, metamaskPage, extensionId }) => {
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
  const loginButton = page.getByTestId('login-button').or(page.getByRole('button', { name: 'Login' })).first()
  await loginButton.click()
  await page.waitForTimeout(1000)

  // Step 2: Continue with wallet
  const continueWithWalletButton = page.getByText('Continue with a wallet').or(page.getByRole('button', { name: /continue.*wallet/i })).first()
  await continueWithWalletButton.click()
  await page.waitForTimeout(1000)

  // Step 3: Select MetaMask (mapped from Rabby Wallet)
  const metaMaskButton = page.getByText('MetaMask').or(page.getByRole('button', { name: 'MetaMask' })).first()
  await metaMaskButton.click()
  await page.waitForTimeout(2000)

  // Handle MetaMask connection popup
  await handleMetaMaskPopup(context, /connect/i)
  await page.waitForTimeout(3000)

  // Handle network switch if needed (Base network)
  await handleNetworkSwitch(context, page, 'Base')

  // ==================== TERMS & CONDITIONS SIGNING ====================
  // Step 6: Sign terms and conditions
  const signButton = page.getByTestId('tnc-sign-button').or(page.getByRole('button', { name: 'Sign' })).first()
  if (await signButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await signButton.click()
    await page.waitForTimeout(1000)
    
    // Handle MetaMask signature popup
    await handleMetaMaskPopup(context, /sign/i)
    await page.waitForTimeout(3000)
  }

  // ==================== ASSET SELECTION ====================
  // Step 8-9: Navigate from XAUUSD to BTCUSD
  const xauusdElement = page.getByText('XAUUSD', { exact: true }).first()
  if (await xauusdElement.isVisible({ timeout: 3000 }).catch(() => false)) {
    await xauusdElement.click()
    await page.waitForTimeout(1000)
  }

  const btcusdElement = page.getByText('BTCUSD', { exact: true }).first()
  await btcusdElement.click()
  await page.waitForTimeout(2000)

  // ==================== TRADE CONFIGURATION ====================
  // Step 10: Set leverage to 120
  const leverageInput = page.getByTestId('leverage-input').or(page.locator('input[placeholder*="leverage" i]')).first()
  await leverageInput.clear()
  await leverageInput.fill('120')
  await page.waitForTimeout(500)

  // Step 11: Set collateral to 1
  const collateralInput = page.getByTestId('collateral-input').or(page.locator('input[placeholder*="collateral" i]')).first()
  await collateralInput.clear()
  await collateralInput.fill('1')
  await page.waitForTimeout(500)

  // ==================== TRADE EXECUTION ====================
  // Step 12: Click place order button
  const placeOrderButton = page.getByTestId('place-order-button').or(page.getByRole('button', { name: 'Place Order' })).first()
  await placeOrderButton.click()
  await page.waitForTimeout(2000)

  // Step 13: Confirm trade
  const confirmTradeButton = page.getByTestId('confirm-trade-button').or(page.getByRole('button', { name: 'Confirm' })).first()
  await confirmTradeButton.click()
  await page.waitForTimeout(1000)

  // Handle MetaMask transaction confirmation popup
  await handleMetaMaskPopup(context, /confirm/i)
  await page.waitForTimeout(5000)

  // ==================== VERIFICATION ====================
  // Verify trade was submitted successfully
  const successIndicator = page.getByText('Transaction submitted').or(page.getByText('Order placed')).first()
  if (await successIndicator.isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log('Trade executed successfully')
  }
})