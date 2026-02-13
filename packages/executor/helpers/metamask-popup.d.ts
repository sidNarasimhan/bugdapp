import type { BrowserContext, Page } from '@playwright/test';
/**
 * MetaMask popup handling helpers for Playwright/Synpress tests
 *
 * These helpers provide reliable handling of MetaMask popup windows,
 * which is often unreliable with Synpress's built-in methods.
 */
export interface PopupOptions {
    timeout?: number;
    pollInterval?: number;
    debug?: boolean;
}
/**
 * Find and interact with MetaMask popup to click a specific button
 *
 * @param context - Playwright browser context
 * @param buttonName - Name of the button to click (string or RegExp for pattern matching)
 * @param options - Configuration options
 * @returns true if button was clicked, false if not found
 *
 * @example
 * // Click the Connect button
 * await handleMetaMaskPopup(context, 'Connect');
 *
 * @example
 * // Click Confirm or Sign button
 * await handleMetaMaskPopup(context, /confirm|sign/i, { timeout: 15000 });
 */
export declare function handleMetaMaskPopup(context: BrowserContext, buttonName: string | RegExp, options?: PopupOptions): Promise<boolean>;
/**
 * Handle network switch requests from dApps
 *
 * When a dApp requests a network switch, MetaMask shows a popup asking for approval.
 * This helper finds and approves that request.
 *
 * @param context - Playwright browser context
 * @param options - Configuration options
 * @returns true if network switch was approved, false if not found
 */
export declare function handleNetworkSwitch(context: BrowserContext, options?: PopupOptions): Promise<boolean>;
/**
 * Handle transaction confirmation in MetaMask
 *
 * This is specifically for eth_sendTransaction calls where MetaMask
 * shows a confirmation dialog with gas fees.
 *
 * @param context - Playwright browser context
 * @param options - Configuration options
 * @returns true if transaction was confirmed
 */
export declare function handleTransactionConfirmation(context: BrowserContext, options?: PopupOptions): Promise<boolean>;
/**
 * Handle signature request in MetaMask
 *
 * For personal_sign, eth_signTypedData, etc.
 * Note: MetaMask uses "Confirm" button for signatures, not "Sign"
 *
 * @param context - Playwright browser context
 * @param options - Configuration options
 * @returns true if signature was approved
 */
export declare function handleSignatureRequest(context: BrowserContext, options?: PopupOptions): Promise<boolean>;
/**
 * Handle wallet connection request
 *
 * @param context - Playwright browser context
 * @param options - Configuration options
 * @returns true if connection was approved
 */
export declare function handleConnectionRequest(context: BrowserContext, options?: PopupOptions): Promise<boolean>;
/**
 * Close any open MetaMask home tabs
 *
 * MetaMask sometimes opens its home tab which can interfere with tests.
 * Call this at the start of tests to ensure a clean state.
 *
 * @param context - Playwright browser context
 */
export declare function closeMetaMaskHomeTabs(context: BrowserContext): Promise<number>;
/**
 * Wait for MetaMask to be ready
 *
 * Sometimes MetaMask needs a moment after extension load.
 *
 * @param context - Playwright browser context
 * @param timeout - Maximum time to wait (default: 5000ms)
 */
export declare function waitForMetaMaskReady(context: BrowserContext, timeout?: number): Promise<boolean>;
/**
 * Handle multiple sequential MetaMask popups
 *
 * Some dApp interactions trigger multiple popups in sequence
 * (e.g., connect → sign → switch network)
 *
 * @param context - Playwright browser context
 * @param buttons - Array of button names to click in order
 * @param options - Configuration options
 */
export declare function handleMultiplePopups(context: BrowserContext, buttons: (string | RegExp)[], options?: PopupOptions & {
    delayBetween?: number;
}): Promise<boolean[]>;
/**
 * Find all MetaMask extension pages (popups, home, etc.)
 */
export declare function findMetaMaskPages(context: BrowserContext): Promise<Page[]>;
/**
 * Check if a MetaMask popup is currently visible
 */
export declare function isMetaMaskPopupVisible(context: BrowserContext): Promise<boolean>;
//# sourceMappingURL=metamask-popup.d.ts.map