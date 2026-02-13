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
export async function handleMetaMaskPopup(context, buttonName, options = {}) {
    const { timeout = 10000, pollInterval = 500, debug = false } = options;
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const pages = context.pages();
        for (const page of pages) {
            const url = page.url();
            // MetaMask notification popups have this URL pattern
            if (url.includes('chrome-extension://') && url.includes('notification')) {
                if (debug) {
                    console.log(`[MetaMask] Found popup: ${url}`);
                }
                await page.bringToFront();
                await page.waitForTimeout(500);
                const button = page.getByRole('button', { name: buttonName });
                if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await button.click();
                    if (debug) {
                        console.log(`[MetaMask] Clicked "${buttonName}"`);
                    }
                    return true;
                }
            }
        }
        await new Promise(r => setTimeout(r, pollInterval));
    }
    if (debug) {
        console.log(`[MetaMask] Popup with "${buttonName}" not found within ${timeout}ms`);
    }
    return false;
}
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
export async function handleNetworkSwitch(context, options = {}) {
    const { timeout = 5000, pollInterval = 500, debug = false } = options;
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            const pages = context.pages();
            for (const page of pages) {
                try {
                    const url = page.url();
                    if (url.includes('chrome-extension://') && url.includes('notification')) {
                        await page.bringToFront();
                        await page.waitForTimeout(500);
                        // Look for "Switch network" or "Approve" button for network change
                        const switchBtn = page.getByRole('button', { name: /switch network|approve/i });
                        if (await switchBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                            await switchBtn.click();
                            if (debug) {
                                console.log('[MetaMask] Approved network switch');
                            }
                            return true;
                        }
                    }
                }
                catch {
                    // Page might have closed, continue
                }
            }
        }
        catch {
            // Context issue, continue
        }
        await new Promise(r => setTimeout(r, pollInterval));
    }
    return false;
}
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
export async function handleTransactionConfirmation(context, options = {}) {
    return handleMetaMaskPopup(context, /confirm/i, { timeout: 15000, ...options });
}
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
export async function handleSignatureRequest(context, options = {}) {
    return handleMetaMaskPopup(context, /confirm|sign/i, { timeout: 10000, ...options });
}
/**
 * Handle wallet connection request
 *
 * @param context - Playwright browser context
 * @param options - Configuration options
 * @returns true if connection was approved
 */
export async function handleConnectionRequest(context, options = {}) {
    return handleMetaMaskPopup(context, 'Connect', { timeout: 10000, ...options });
}
/**
 * Close any open MetaMask home tabs
 *
 * MetaMask sometimes opens its home tab which can interfere with tests.
 * Call this at the start of tests to ensure a clean state.
 *
 * @param context - Playwright browser context
 */
export async function closeMetaMaskHomeTabs(context) {
    const pages = context.pages();
    let closed = 0;
    for (const page of pages) {
        const url = page.url();
        if (url.includes('chrome-extension://') && url.includes('home.html')) {
            await page.close();
            closed++;
        }
    }
    return closed;
}
/**
 * Wait for MetaMask to be ready
 *
 * Sometimes MetaMask needs a moment after extension load.
 *
 * @param context - Playwright browser context
 * @param timeout - Maximum time to wait (default: 5000ms)
 */
export async function waitForMetaMaskReady(context, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const pages = context.pages();
        for (const page of pages) {
            const url = page.url();
            if (url.includes('chrome-extension://')) {
                // MetaMask extension is loaded
                return true;
            }
        }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}
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
export async function handleMultiplePopups(context, buttons, options = {}) {
    const { delayBetween = 2000, ...popupOptions } = options;
    const results = [];
    for (const buttonName of buttons) {
        const result = await handleMetaMaskPopup(context, buttonName, popupOptions);
        results.push(result);
        if (result) {
            await new Promise(r => setTimeout(r, delayBetween));
        }
    }
    return results;
}
/**
 * Find all MetaMask extension pages (popups, home, etc.)
 */
export async function findMetaMaskPages(context) {
    return context.pages().filter(page => page.url().includes('chrome-extension://'));
}
/**
 * Check if a MetaMask popup is currently visible
 */
export async function isMetaMaskPopupVisible(context) {
    const pages = context.pages();
    return pages.some(page => page.url().includes('chrome-extension://') &&
        page.url().includes('notification'));
}
//# sourceMappingURL=metamask-popup.js.map