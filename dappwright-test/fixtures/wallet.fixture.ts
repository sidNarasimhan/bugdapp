import 'dotenv/config';

/**
 * Playwright test fixtures that bootstrap a Chromium browser context
 * with MetaMask installed and configured via dappwright.
 *
 * Usage in test files:
 *   import { test, expect } from '../fixtures/wallet.fixture';
 *   test('my test', async ({ wallet, page }) => { ... });
 *
 * The `wallet` fixture provides the full Dappwright API:
 *   wallet.approve()
 *   wallet.confirmTransaction()
 *   wallet.sign()
 *   wallet.confirmNetworkSwitch()
 *   wallet.addNetwork(...)
 *   wallet.switchNetwork(...)
 *   wallet.reject()
 *   ... etc.
 */

import { test as base, expect } from '@playwright/test';
import type { BrowserContext, CDPSession } from 'playwright-core';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  bootstrap,
  type Dappwright,
  getWallet,
  MetaMaskWallet,
} from '@tenkeylabs/dappwright';

// Default seed phrase - Hardhat's default mnemonic
// In production, override via SEED_PHRASE env var
const SEED_PHRASE =
  process.env.SEED_PHRASE ||
  'test test test test test test test test test test test junk';

// Whether to run headless (uses Chromium's --headless=new which supports extensions)
const HEADLESS = process.env.HEADLESS === 'true';

// MetaMask version - use dappwright's recommended version (currently 13.17.0)
// or pin to a specific version via env var
const METAMASK_VERSION =
  process.env.METAMASK_VERSION || MetaMaskWallet.recommendedVersion;

// Step screenshots output directory
const STEP_SCREENSHOTS_DIR = process.env.STEP_SCREENSHOTS_DIR || '/tmp/test-results/steps';

/**
 * Extended Playwright test with wallet fixtures.
 *
 * Fixtures provided:
 * - walletContext: The BrowserContext with MetaMask loaded (worker-scoped, shared across tests)
 * - context: Alias for walletContext (so page automatically uses the wallet context)
 * - wallet: The Dappwright wallet API instance
 */
export const test = base.extend<
  { wallet: Dappwright },
  { walletContext: BrowserContext }
>({
  // Worker-scoped: the browser context is created once per worker
  // and shared across all tests in that worker
  walletContext: [
    async ({}, use) => {
      const [wallet, _, context] = await bootstrap('', {
        wallet: 'metamask',
        version: METAMASK_VERSION,
        seed: SEED_PHRASE,
        headless: HEADLESS,
      });

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  // Override the default context to use our wallet context
  context: async ({ walletContext }, use) => {
    await use(walletContext);
  },

  // Override page to add high-quality CDP screencast capture
  page: async ({ context }, use, testInfo) => {
    const page = await context.newPage();

    // Start high-quality CDP screencast (80% JPEG at 1280x720)
    const framesDir = join(testInfo.outputDir, '_screencast_frames');
    let cdpSession: CDPSession | null = null;
    let frameIndex = 0;
    interface ScreencastFrame { index: number; filename: string; timestamp: number; }
    const frames: ScreencastFrame[] = [];

    try {
      mkdirSync(framesDir, { recursive: true });
      cdpSession = await context.newCDPSession(page);

      cdpSession.on('Page.screencastFrame', async (params: any) => {
        try {
          const { data, metadata, sessionId } = params;
          const filename = `frame-${String(frameIndex).padStart(5, '0')}.jpg`;
          writeFileSync(join(framesDir, filename), Buffer.from(data, 'base64'));
          frames.push({ index: frameIndex, filename, timestamp: metadata.timestamp * 1000 });
          frameIndex++;
          await cdpSession!.send('Page.screencastFrameAck', { sessionId });
        } catch { /* frame dropped, non-fatal */ }
      });

      await cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 3, // Every 3rd frame — smooth playback, ~3x smaller zip
      });
    } catch {
      // Screencast capture not available — non-fatal
    }

    await use(page);

    // Stop screencast and save manifest
    if (cdpSession) {
      try {
        await cdpSession.send('Page.stopScreencast');
        await cdpSession.detach();
      } catch { /* session may already be closed */ }
    }

    if (frames.length > 0) {
      const manifest = {
        frameCount: frames.length,
        frames,
        startTimestamp: frames[0].timestamp,
        endTimestamp: frames[frames.length - 1].timestamp,
        width: 1280,
        height: 720,
        quality: 80,
      };
      writeFileSync(
        join(testInfo.outputDir, 'screencast-manifest.json'),
        JSON.stringify(manifest),
      );
    }

    await page.close();
  },

  // Test-scoped: each test gets a fresh wallet reference
  wallet: async ({ walletContext }, use) => {
    const wallet = await getWallet('metamask', walletContext);
    await use(wallet);
  },
});

/**
 * Capture dApp-only screenshots (filtering out MetaMask extension pages).
 * Call this in afterEach or at end of test to get clean dApp screenshots.
 */
export async function captureDappScreenshots(
  context: BrowserContext,
  testName: string,
): Promise<string[]> {
  const paths: string[] = [];

  try {
    if (!existsSync(STEP_SCREENSHOTS_DIR)) {
      mkdirSync(STEP_SCREENSHOTS_DIR, { recursive: true });
    }

    const pages = context.pages();
    let idx = 0;

    for (const page of pages) {
      if (page.isClosed()) continue;
      const url = page.url();

      // Skip MetaMask extension pages
      if (url.startsWith('chrome-extension://')) continue;
      // Skip blank pages
      if (url === 'about:blank') continue;

      idx++;
      const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
      const fileName = `dapp-${safeName}-${idx}.png`;
      const filePath = join(STEP_SCREENSHOTS_DIR, fileName);

      await page.bringToFront();
      await page.waitForTimeout(300);
      await page.screenshot({ path: filePath, fullPage: false });
      paths.push(filePath);
    }
  } catch {
    // Don't fail the test
  }

  return paths;
}

/**
 * Race-safe wallet connection + SIWE approval.
 *
 * MetaMask Manifest V3 has two critical issues:
 * 1. Popups may open BEFORE dappwright's waitForEvent('page') listener
 * 2. Popups may NEVER auto-open (MV3 queues the request but doesn't create a window)
 *
 * This helper handles both by:
 * - Checking for already-open popups first
 * - Falling back to manually opening chrome-extension://<id>/notification.html
 * - Polling for SIWE popups (Privy/dApps may trigger with delay)
 */
export async function raceApprove(
  wallet: Dappwright,
  context: BrowserContext,
  page: InstanceType<typeof import('playwright-core').Page>,
  options?: { skipSiwe?: boolean },
): Promise<void> {
  // --- Helpers ---

  const findNotifPopup = () => context.pages().find(
    (p) => { try { return p.url().includes('notification') && !p.isClosed(); } catch { return false; } }
  );

  const getExtensionId = (): string | null => {
    const mmPage = context.pages().find(
      (p) => { try { return p.url().startsWith('chrome-extension://') && !p.url().includes('notification'); } catch { return false; } }
    );
    if (!mmPage) return null;
    try { return new URL(mmPage.url()).hostname; } catch { return null; }
  };

  /** Open notification.html manually and click visible buttons */
  const openNotificationAndClick = async (mode: 'connect' | 'sign'): Promise<void> => {
    const extId = getExtensionId();
    if (!extId) return;

    const notifPage = await context.newPage();
    await notifPage.goto(`chrome-extension://${extId}/notification.html`);
    await notifPage.waitForLoadState('domcontentloaded').catch(() => {});
    await notifPage.waitForTimeout(2000);

    if (mode === 'connect') {
      // Connection flow: click Connect/Next, then Confirm
      const connectBtn = notifPage.getByTestId('confirm-btn')
        .or(notifPage.locator('button:has-text("Connect")').first())
        .or(notifPage.locator('button:has-text("Next")').first())
        .or(notifPage.locator('button:has-text("Confirm")').first());
      if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await connectBtn.click();
        await notifPage.waitForTimeout(1000);
      }
      // Second screen (permissions)
      if (!notifPage.isClosed()) {
        const permBtn = notifPage.getByTestId('confirm-btn')
          .or(notifPage.locator('button:has-text("Connect")').first())
          .or(notifPage.locator('button:has-text("Confirm")').first());
        if (await permBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await permBtn.click();
          await notifPage.waitForTimeout(500);
        }
      }
    } else {
      // SIWE sign flow: scroll if needed, then click Sign/Confirm
      const scrollBtn = notifPage.getByTestId('confirm-scroll-to-bottom')
        .or(notifPage.getByTestId('signature-request-scroll-button'))
        .or(notifPage.locator('[data-testid*="scroll"]').first());
      if (await scrollBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await scrollBtn.click();
        await notifPage.waitForTimeout(500);
      }
      const signBtn = notifPage.getByTestId('confirm-footer-button')
        .or(notifPage.getByTestId('confirm-btn'))
        .or(notifPage.locator('button:has-text("Sign")').first())
        .or(notifPage.locator('button:has-text("Confirm")').first());
      if (await signBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await signBtn.click();
        await notifPage.waitForTimeout(500);
      }
    }

    // Wait for popup to close, then force-close if needed
    if (!notifPage.isClosed()) {
      await notifPage.waitForEvent('close', { timeout: 10000 }).catch(() => {});
    }
    if (!notifPage.isClosed()) {
      await notifPage.close().catch(() => {});
    }
  };

  /** Handle buttons on an already-open notification popup */
  const handleExistingPopup = async (popup: any, mode: 'connect' | 'sign'): Promise<void> => {
    await popup.bringToFront();
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(1000);

    if (mode === 'connect') {
      const connectBtn = popup.getByTestId('confirm-btn')
        .or(popup.locator('button:has-text("Connect")').first())
        .or(popup.locator('button:has-text("Next")').first())
        .or(popup.locator('button:has-text("Confirm")').first());
      if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await connectBtn.click();
        await popup.waitForTimeout(1000);
      }
      if (!popup.isClosed()) {
        const permBtn = popup.getByTestId('confirm-btn')
          .or(popup.locator('button:has-text("Connect")').first())
          .or(popup.locator('button:has-text("Confirm")').first());
        if (await permBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await permBtn.click();
          await popup.waitForTimeout(500);
        }
      }
    } else {
      const scrollBtn = popup.getByTestId('confirm-scroll-to-bottom')
        .or(popup.getByTestId('signature-request-scroll-button'))
        .or(popup.locator('[data-testid*="scroll"]').first());
      if (await scrollBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await scrollBtn.click();
        await popup.waitForTimeout(500);
      }
      const signBtn = popup.getByTestId('confirm-footer-button')
        .or(popup.getByTestId('confirm-btn'))
        .or(popup.locator('button:has-text("Sign")').first())
        .or(popup.locator('button:has-text("Confirm")').first());
      if (await signBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await signBtn.click();
        await popup.waitForTimeout(500);
      }
    }

    if (!popup.isClosed()) {
      await popup.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    }
  };

  // --- Step 1: Approve connection ---
  const existingPopup = findNotifPopup();
  if (existingPopup) {
    await handleExistingPopup(existingPopup, 'connect');
  } else {
    // Skip wallet.approve() — it wastes 30s waiting for a popup that won't auto-open in MV3 headless.
    // Go straight to manual notification.html which is fast and reliable.
    await openNotificationAndClick('connect');
  }

  await page.waitForTimeout(2000);
  await page.bringToFront();

  // --- Step 2: Auto-handle SIWE popup (Privy/dApps trigger after connection) ---
  // Skip if caller will handle SIWE explicitly (e.g. dApp needs a button click first)
  if (!options?.skipSiwe) {
    // Poll for MetaMask SIWE popup — dApps may take a few seconds to trigger it
    let siweHandled = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(2000);
      const siwePopup = findNotifPopup();
      if (siwePopup) {
        await handleExistingPopup(siwePopup, 'sign');
        siweHandled = true;
        break;
      }
    }

    if (!siweHandled) {
      // No popup after 6s polling — go straight to manual notification.html
      // (Skip wallet.sign() — it wastes 30s waiting for a popup that won't open in MV3)
      await openNotificationAndClick('sign');
    }

    await page.waitForTimeout(2000);
    await page.bringToFront();
  }
}

/**
 * Race-safe MetaMask sign handling.
 *
 * Use this AFTER clicking a dApp's "Sign" button that triggers a MetaMask
 * personal_sign request. Handles the MV3 popup-not-opening issue.
 * For dApps where SIWE auto-triggers (Privy), use raceApprove instead.
 */
export async function raceSign(
  wallet: Dappwright,
  context: BrowserContext,
  page: InstanceType<typeof import('playwright-core').Page>,
): Promise<void> {
  const findNotifPopup = () => context.pages().find(
    (p) => { try { return p.url().includes('notification') && !p.isClosed(); } catch { return false; } }
  );

  const getExtensionId = (): string | null => {
    const mmPage = context.pages().find(
      (p) => { try { return p.url().startsWith('chrome-extension://') && !p.url().includes('notification'); } catch { return false; } }
    );
    if (!mmPage) return null;
    try { return new URL(mmPage.url()).hostname; } catch { return null; }
  };

  // Wait a moment for MetaMask to receive the sign request
  await page.waitForTimeout(2000);

  // Check for already-open popup
  const popup = findNotifPopup();
  if (popup) {
    await popup.bringToFront();
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(1000);

    // Scroll if needed
    const scrollBtn = popup.getByTestId('confirm-scroll-to-bottom')
      .or(popup.getByTestId('signature-request-scroll-button'))
      .or(popup.locator('[data-testid*="scroll"]').first());
    if (await scrollBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await scrollBtn.click();
      await popup.waitForTimeout(500);
    }

    const signBtn = popup.getByTestId('confirm-footer-button')
      .or(popup.getByTestId('confirm-btn'))
      .or(popup.locator('button:has-text("Sign")').first())
      .or(popup.locator('button:has-text("Confirm")').first());
    if (await signBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await signBtn.click();
    }

    if (!popup.isClosed()) {
      await popup.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    }
  } else {
    // No popup — go straight to manual notification.html (skip wallet.sign() — wastes 30s on MV3)
    const extId = getExtensionId();
    if (extId) {
      const notifPage = await context.newPage();
      await notifPage.goto(`chrome-extension://${extId}/notification.html`);
      await notifPage.waitForLoadState('domcontentloaded').catch(() => {});
      await notifPage.waitForTimeout(2000);

      const scrollBtn = notifPage.getByTestId('confirm-scroll-to-bottom')
        .or(notifPage.getByTestId('signature-request-scroll-button'))
        .or(notifPage.locator('[data-testid*="scroll"]').first());
      if (await scrollBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await scrollBtn.click();
        await notifPage.waitForTimeout(500);
      }

      const signBtn = notifPage.getByTestId('confirm-footer-button')
        .or(notifPage.getByTestId('confirm-btn'))
        .or(notifPage.locator('button:has-text("Sign")').first())
        .or(notifPage.locator('button:has-text("Confirm")').first());
      if (await signBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await signBtn.click();
        await notifPage.waitForTimeout(500);
      }

      if (!notifPage.isClosed()) {
        await notifPage.waitForEvent('close', { timeout: 10000 }).catch(() => {});
      }
      if (!notifPage.isClosed()) {
        await notifPage.close().catch(() => {});
      }
    }
  }

  await page.waitForTimeout(2000);
  await page.bringToFront();
}

export { expect };
