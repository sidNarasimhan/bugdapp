import { chromium, type Browser, type Page } from '@playwright/test';

export interface DappScreenshot {
  name: string;
  base64: string;
  mediaType: 'image/png' | 'image/jpeg';
}

/**
 * Collects fresh screenshots of a dApp URL using vanilla Playwright (no MetaMask needed).
 * Used during self-healing to give Claude vision of the current dApp UI state.
 */
export class VisualContextCollector {
  /**
   * Open a dApp URL and capture screenshots at key states
   */
  static async collectDappScreenshots(
    dappUrl: string,
    options: { timeout?: number } = {}
  ): Promise<DappScreenshot[]> {
    const { timeout = 30000 } = options;
    const screenshots: DappScreenshot[] = [];
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();

      // Navigate to dApp
      try {
        await page.goto(dappUrl, {
          waitUntil: 'domcontentloaded',
          timeout,
        });
        await page.waitForTimeout(3000); // Let page stabilize
      } catch (navErr) {
        console.warn(`[VisualContext] Navigation failed for ${dappUrl}:`, navErr instanceof Error ? navErr.message : navErr);
        await context.close();
        return screenshots;
      }

      // Screenshot 1: Initial page load
      const initialScreenshot = await page.screenshot({ type: 'png' });
      screenshots.push({
        name: 'initial-load',
        base64: initialScreenshot.toString('base64'),
        mediaType: 'image/png',
      });

      // Screenshot 2: Try to find and click a connect button
      const connectButton = await this.findConnectButton(page);
      if (connectButton) {
        try {
          await connectButton.click({ timeout: 5000 });
          await page.waitForTimeout(2000);

          const afterConnectScreenshot = await page.screenshot({ type: 'png' });
          screenshots.push({
            name: 'after-connect-click',
            base64: afterConnectScreenshot.toString('base64'),
            mediaType: 'image/png',
          });
        } catch {
          // Click failed, that's OK
        }
      }

      await context.close();
    } catch (error) {
      console.error('[VisualContext] Error collecting screenshots:', error instanceof Error ? error.message : error);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    return screenshots;
  }

  /**
   * Heuristic: find a "Connect Wallet" button on the page
   */
  private static async findConnectButton(page: Page) {
    // Common connect button patterns
    const selectors = [
      'button:has-text("Connect Wallet")',
      'button:has-text("Connect")',
      '[data-testid*="connect"]',
      '[data-testid*="wallet"]',
      'button:has-text("Launch App")',
      'button:has-text("Enter App")',
      // RainbowKit
      '[data-testid="rk-connect-button"]',
      'button[class*="rk-"]',
      // Web3Modal
      'w3m-button',
      'w3m-connect-button',
    ];

    for (const selector of selectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 1000 })) {
          return element;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
