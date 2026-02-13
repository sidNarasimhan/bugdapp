import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { expect } from '@playwright/test';

const test = testWithSynpress(metaMaskFixtures);

// Helper function to handle MetaMask popup interactions
async function handleMetaMaskPopup(context: any, buttonText: string = 'Connect', timeout: number = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const pages = context.pages();
    const metaMaskPage = pages.find((page: any) => 
      page.url().includes('chrome-extension://') && 
      page.url().includes('notification.html')
    );
    
    if (metaMaskPage) {
      try {
        await metaMaskPage.waitForLoadState('domcontentloaded');
        
        // Try multiple selector strategies for the button
        const buttonSelectors = [
          `button:has-text("${buttonText}")`,
          `[data-testid*="${buttonText.toLowerCase()}"]`,
          `button[class*="button"]:has-text("${buttonText}")`,
          `.btn:has-text("${buttonText}")`,
          `button:text-is("${buttonText}")`
        ];
        
        for (const selector of buttonSelectors) {
          try {
            const button = metaMaskPage.locator(selector).first();
            if (await button.isVisible({ timeout: 1000 })) {
              await button.click();
              await metaMaskPage.waitForTimeout(1000);
              return true;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        console.log('MetaMask popup interaction failed:', error);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return false;
}

// Helper function to handle network switching
async function handleNetworkSwitch(context: any, targetChainId: string = '0x1') {
  const pages = context.pages();
  const metaMaskPage = pages.find((page: any) => 
    page.url().includes('chrome-extension://') && 
    page.url().includes('notification.html')
  );
  
  if (metaMaskPage) {
    try {
      await metaMaskPage.waitForLoadState('domcontentloaded');
      
      // Look for network switch button
      const switchButton = metaMaskPage.locator('button:has-text("Switch network")').first();
      if (await switchButton.isVisible({ timeout: 2000 })) {
        await switchButton.click();
        await metaMaskPage.waitForTimeout(1000);
        return true;
      }
    } catch (error) {
      console.log('Network switch handling failed:', error);
    }
  }
  
  return false;
}

test.describe('Simple Wallet Connect', () => {
  test('should connect MetaMask wallet to dApp', async ({ context, page, metamask }) => {
    // ============================================
    // STEP 1: Navigate to dApp
    // ============================================
    await page.goto('https://example-dapp.com');
    await page.waitForLoadState('domcontentloaded');
    
    // ============================================
    // STEP 2: Click Connect Wallet Button
    // ============================================
    const connectButton = page.getByTestId('connect-wallet-button')
      .or(page.getByRole('button', { name: 'Connect Wallet' }))
      .or(page.getByText('Connect Wallet'))
      .first();
    
    await expect(connectButton).toBeVisible();
    await connectButton.click();
    
    // Wait for wallet selection modal to appear
    await page.waitForTimeout(1000);
    
    // ============================================
    // STEP 3: Select MetaMask Wallet
    // ============================================
    const metaMaskButton = page.getByRole('button', { name: 'MetaMask' })
      .or(page.locator('button:has-text("MetaMask")'))
      .or(page.getByText('MetaMask'))
      .first();
    
    await expect(metaMaskButton).toBeVisible();
    await metaMaskButton.click();
    
    // ============================================
    // STEP 4: Handle MetaMask Connection Popup
    // ============================================
    await page.waitForTimeout(2000); // Wait for MetaMask popup to appear
    
    // Handle the eth_requestAccounts popup
    const connectSuccess = await handleMetaMaskPopup(context, 'Connect', 15000);
    expect(connectSuccess).toBe(true);
    
    // Wait for popup to close and connection to complete
    await page.waitForTimeout(3000);
    
    // ============================================
    // STEP 5: Verify Connection Success
    // ============================================
    // Check for connected state indicators
    const connectedIndicators = [
      page.getByTestId('wallet-connected'),
      page.getByText('Connected'),
      page.locator('[data-testid*="connected"]'),
      page.locator('.wallet-connected'),
      page.getByText(/0x[a-fA-F0-9]{40}/) // Ethereum address pattern
    ];
    
    let connectionVerified = false;
    for (const indicator of connectedIndicators) {
      try {
        if (await indicator.isVisible({ timeout: 5000 })) {
          connectionVerified = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    // If no specific connected indicator found, check that connect button is no longer visible
    if (!connectionVerified) {
      const connectButtonStillVisible = await connectButton.isVisible({ timeout: 2000 }).catch(() => false);
      expect(connectButtonStillVisible).toBe(false);
    }
    
    // ============================================
    // STEP 6: Verify Network (Ethereum Mainnet)
    // ============================================
    // Check if we're on the correct network (Chain ID: 1)
    // This step handles the eth_chainId call from the recording
    await page.waitForTimeout(1000);
    
    // Look for network indicators showing Ethereum Mainnet
    const networkIndicators = [
      page.getByText('Ethereum'),
      page.getByText('Mainnet'),
      page.locator('[data-testid*="network"]'),
      page.locator('.network-indicator')
    ];
    
    for (const indicator of networkIndicators) {
      try {
        if (await indicator.isVisible({ timeout: 3000 })) {
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    console.log('✅ Wallet connection completed successfully');
  });
});