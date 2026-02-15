/**
 * Standalone wallet helper functions for in-process spec execution.
 * These are extracted from dappwright-test/fixtures/wallet.fixture.ts
 * for use in the hybrid runner (which executes spec code in-process
 * rather than via Playwright subprocess).
 *
 * Keep in sync with wallet.fixture.ts if the MetaMask MV3 handling changes.
 */

import type { BrowserContext, Page } from 'playwright-core';
import type { Dappwright } from '@tenkeylabs/dappwright';

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
  page: Page,
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
      const connectBtn = notifPage.getByTestId('confirm-btn')
        .or(notifPage.locator('button:has-text("Connect")').first())
        .or(notifPage.locator('button:has-text("Next")').first())
        .or(notifPage.locator('button:has-text("Confirm")').first());
      if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await connectBtn.click();
        await notifPage.waitForTimeout(1000);
      }
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

    if (!notifPage.isClosed()) {
      await notifPage.waitForEvent('close', { timeout: 10000 }).catch(() => {});
    }
    if (!notifPage.isClosed()) {
      await notifPage.close().catch(() => {});
    }
  };

  /** Handle buttons on an already-open notification popup */
  const handleExistingPopup = async (popup: Page, mode: 'connect' | 'sign'): Promise<void> => {
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
    await openNotificationAndClick('connect');
  }

  await page.waitForTimeout(2000);
  await page.bringToFront();

  // --- Step 2: Auto-handle SIWE popup (Privy/dApps trigger after connection) ---
  if (!options?.skipSiwe) {
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
 */
export async function raceSign(
  wallet: Dappwright,
  context: BrowserContext,
  page: Page,
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

  await page.waitForTimeout(2000);

  const popup = findNotifPopup();
  if (popup) {
    await popup.bringToFront();
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(1000);

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
