import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for dappwright-based web3 tests.
 *
 * Key differences from Synpress config:
 * - No Synpress CLI needed (no `synpress` build:cache step)
 * - Browser context with MetaMask is bootstrapped via dappwright fixtures
 * - Only Chromium is supported (MetaMask is a Chrome extension)
 * - headless mode uses --headless=new (Chromium's new headless mode that supports extensions)
 */
export default defineConfig({
  testDir: './test/playwright',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'metamask',
      testMatch: '**/*.spec.ts',
    },
  ],
});
