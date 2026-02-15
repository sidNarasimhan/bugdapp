import type { Page } from 'playwright-core';
import type { ToolDefinition, ToolCallResult, AgentContext } from '../types.js';

// ============================================================================
// Wallet Tool Definitions (for Claude API)
// ============================================================================

export const walletToolDefinitions: ToolDefinition[] = [
  {
    name: 'wallet_approve',
    description: `Approve a pending wallet connection request in MetaMask. Call this AFTER clicking the dApp's "Connect Wallet" / "MetaMask" button which triggers the MetaMask popup.

This tool is RACE-SAFE: it detects already-open MetaMask popups (which open instantly when the dApp triggers eth_requestAccounts). It also AUTO-HANDLES SIWE (Sign-In With Ethereum) popups that Privy and other dApps trigger immediately after connection.

After calling this, use assert_wallet_connected to verify the connection succeeded.

IMPORTANT: This ONLY handles connection approval, NOT network changes or signatures.`,
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'wallet_sign',
    description: 'Sign a pending message in MetaMask (personal_sign, signTypedData). This is RACE-SAFE: it detects already-open MetaMask signature popups. Call this AFTER the dApp has triggered a signature request. Note: For Privy SIWE, wallet_approve already handles the SIWE popup automatically — you do NOT need to call this separately.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'wallet_confirm_transaction',
    description: 'Confirm a pending transaction in MetaMask. Call this AFTER the dApp has triggered a transaction (eth_sendTransaction).',
    input_schema: {
      type: 'object',
      properties: {
        gas: { type: 'number', description: 'Optional gas override' },
        gasLimit: { type: 'number', description: 'Optional gas limit override' },
      },
    },
  },
  {
    name: 'wallet_switch_network',
    description: 'Switch MetaMask to a different network. Use this INSTEAD of clicking network switch buttons on the dApp. After switching, the dApp page is brought to front and reloaded automatically. Network names: "Base", "Arbitrum One", "OP Mainnet", "Polygon Mainnet", "Avalanche Network C-Chain", "BNB Smart Chain".',
    input_schema: {
      type: 'object',
      properties: {
        networkName: {
          type: 'string',
          description: 'Network name exactly as MetaMask shows it (e.g., "Base", "Arbitrum One")',
        },
      },
      required: ['networkName'],
    },
  },
  {
    name: 'wallet_handle_siwe_popup',
    description: 'Handle a SIWE (Sign-In With Ethereum) popup that may already be open. This uses race-safe detection. Note: wallet_approve now auto-handles SIWE after connection, so you typically do NOT need this. Only call this if wallet_approve reports it did NOT handle SIWE and you know SIWE is needed.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'wallet_reject',
    description: 'Reject any pending MetaMask request (connection, signature, or transaction).',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ============================================================================
// MetaMask Popup Helpers
// ============================================================================

/**
 * Find an already-open MetaMask notification popup.
 */
function findMetaMaskPopup(ctx: AgentContext): Page | undefined {
  return ctx.context.pages().find(
    (p) => {
      try {
        return p.url().includes('notification') && !p.isClosed();
      } catch {
        return false;
      }
    }
  );
}

/**
 * Get MetaMask extension ID from context pages.
 */
function getMetaMaskExtensionId(ctx: AgentContext): string | null {
  const mmPage = ctx.context.pages().find(
    (p) => { try { return p.url().startsWith('chrome-extension://') && !p.url().includes('notification'); } catch { return false; } }
  );
  if (!mmPage) return null;
  try { return new URL(mmPage.url()).hostname; } catch { return null; }
}

/**
 * Manually open MetaMask notification.html.
 * MetaMask MV3 sometimes queues requests without opening a popup window.
 * This forces the notification page open so we can interact with it.
 */
async function openNotificationManually(ctx: AgentContext): Promise<Page | null> {
  const extId = getMetaMaskExtensionId(ctx);
  if (!extId) {
    console.log('[WalletTools] openNotificationManually: Could not find MetaMask extension ID');
    return null;
  }
  const notifUrl = `chrome-extension://${extId}/notification.html`;
  console.log(`[WalletTools] openNotificationManually: Opening ${notifUrl}`);
  const notifPage = await ctx.context.newPage();
  await notifPage.goto(notifUrl);
  await notifPage.waitForLoadState('domcontentloaded').catch(() => {});
  await notifPage.waitForTimeout(2000);
  return notifPage;
}

/**
 * Detect what type of MetaMask popup is open.
 * MetaMask v13.17 uses distinct testids:
 *   - Connection: confirm-btn, cancel-btn, accounts-tab, permissions-tab
 *   - Signature/SIWE: confirm-footer-button, or page with sign request content
 *   - Transaction: confirm-footer-button with gas/fee info
 */
async function detectPopupType(popup: Page): Promise<'connection' | 'signature' | 'transaction' | 'unknown'> {
  try {
    // Connection popup has accounts-tab or confirm-btn (not confirm-footer-button)
    const hasAccountsTab = await popup.getByTestId('accounts-tab').isVisible({ timeout: 1000 }).catch(() => false);
    const hasConfirmBtn = await popup.getByTestId('confirm-btn').isVisible({ timeout: 500 }).catch(() => false);
    if (hasAccountsTab || hasConfirmBtn) {
      return 'connection';
    }

    // Signature popup has confirm-footer-button or signature-related content
    const hasConfirmFooter = await popup.getByTestId('confirm-footer-button').isVisible({ timeout: 500 }).catch(() => false);
    if (hasConfirmFooter) {
      // Could be signature or transaction — check for gas info
      const hasGas = await popup.locator('text=/gas|fee|gwei/i').isVisible({ timeout: 500 }).catch(() => false);
      return hasGas ? 'transaction' : 'signature';
    }

    // Fallback: check for sign/confirm buttons by text
    const hasSignBtn = await popup.locator('button:has-text("Sign")').isVisible({ timeout: 500 }).catch(() => false);
    if (hasSignBtn) return 'signature';

    const hasConfirmText = await popup.locator('button:has-text("Confirm")').isVisible({ timeout: 500 }).catch(() => false);
    if (hasConfirmText) return 'transaction';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Handle MetaMask connection popup.
 * MetaMask v13.17 uses testid="confirm-btn" for Connect and testid="cancel-btn" for Cancel.
 */
async function handleConnectionPopup(popup: Page): Promise<boolean> {
  try {
    await popup.bringToFront();
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(1000);

    // Debug: list buttons
    try {
      const buttons = await popup.locator('button').all();
      for (const btn of buttons) {
        const text = await btn.textContent().catch(() => '?');
        const testId = await btn.getAttribute('data-testid').catch(() => '');
        console.log(`[WalletTools]   Connection popup button: "${text?.trim()}" testid="${testId}"`);
      }
    } catch {}

    // MetaMask v13.17: confirm-btn is the Connect button
    // Try v13.17 testids first, then fall back to older patterns
    const connectBtn = popup.getByTestId('confirm-btn')
      .or(popup.getByTestId('page-container-footer-next'))
      .or(popup.locator('button:has-text("Connect")').first())
      .or(popup.locator('button:has-text("Confirm")').first())
      .or(popup.locator('button:has-text("Next")').first());

    if (await connectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('[WalletTools]   Clicking Connect button');
      await connectBtn.click();
      await popup.waitForTimeout(1000);
    }

    // After clicking Next/Connect, a second screen (permissions) may appear
    // Check if popup is still open and has another confirm button
    if (!popup.isClosed()) {
      const permBtn = popup.getByTestId('confirm-btn')
        .or(popup.getByTestId('page-container-footer-next'))
        .or(popup.locator('button:has-text("Connect")').first())
        .or(popup.locator('button:has-text("Confirm")').first());

      if (await permBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('[WalletTools]   Clicking second Connect/Confirm button (permissions)');
        await permBtn.click();
        await popup.waitForTimeout(500);
      }
    }

    // Wait for popup to close
    if (!popup.isClosed()) {
      await popup.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    }

    return true;
  } catch (e) {
    console.log(`[WalletTools]   handleConnectionPopup failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * Handle MetaMask SIWE (Sign-In With Ethereum) / signature confirmation popup.
 * MetaMask v13.17 uses testid="confirm-footer-button" for Sign/Confirm.
 */
async function handleSiweConfirmation(popup: Page): Promise<boolean> {
  try {
    await popup.bringToFront();
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForTimeout(1500);

    // Debug: list all buttons
    try {
      const buttons = await popup.locator('button').all();
      for (const btn of buttons) {
        const text = await btn.textContent().catch(() => '?');
        const testId = await btn.getAttribute('data-testid').catch(() => '');
        const visible = await btn.isVisible().catch(() => false);
        console.log(`[WalletTools]   SIWE popup button: "${text?.trim()}" testid="${testId}" visible=${visible}`);
      }
    } catch {
      console.log('[WalletTools]   Could not enumerate buttons');
    }

    // MetaMask v13.17 may require scrolling before Sign is enabled
    for (const scrollSel of [
      popup.getByTestId('confirm-scroll-to-bottom'),
      popup.getByTestId('signature-request-scroll-button'),
      popup.locator('[data-testid*="scroll"]').first(),
    ]) {
      try {
        if (await scrollSel.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log('[WalletTools]   Clicking scroll button');
          await scrollSel.click();
          await popup.waitForTimeout(500);
          break;
        }
      } catch {}
    }

    // Try MetaMask v13.17 sign/confirm buttons
    const confirmBtn = popup.getByTestId('confirm-footer-button')
      .or(popup.getByTestId('confirm-btn'))
      .or(popup.getByTestId('page-container-footer-next'))
      .or(popup.locator('button:has-text("Sign")').first())
      .or(popup.locator('button:has-text("Confirm")').first())
      .or(popup.locator('button.btn-primary').first());

    await confirmBtn.click({ timeout: 5000 });
    console.log('[WalletTools]   Clicked SIWE confirm button');

    if (!popup.isClosed()) {
      await popup.waitForEvent('close', { timeout: 15000 }).catch(() => {});
    }

    return true;
  } catch (e) {
    console.log(`[WalletTools]   handleSiweConfirmation failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * Dismiss a stale MetaMask popup by clicking reject/cancel or force-closing.
 */
async function dismissStalePopup(popup: Page): Promise<void> {
  try {
    if (popup.isClosed()) return;
    await popup.bringToFront();
    const rejectBtn = popup.getByTestId('cancel-btn')
      .or(popup.getByRole('button', { name: /reject/i }))
      .or(popup.getByRole('button', { name: /cancel/i }))
      .or(popup.getByTestId('page-container-footer-cancel'));
    if (await rejectBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[WalletTools]   Clicking reject/cancel to dismiss stale popup');
      await rejectBtn.click();
      await popup.waitForTimeout(500);
    }
    if (!popup.isClosed()) {
      console.log('[WalletTools]   Force-closing stale popup');
      await popup.close().catch(() => {});
    }
  } catch {
    try { if (!popup.isClosed()) await popup.close(); } catch {}
  }
}

/**
 * Handle any MetaMask signature popup (personal_sign, signTypedData).
 * Race-safe: checks for already-open popup first.
 */
async function handleSignaturePopup(ctx: AgentContext): Promise<{ signed: boolean; method: string }> {
  // Check for already-open popup
  let popup = findMetaMaskPopup(ctx);

  if (popup) {
    console.log('[WalletTools] Found existing MetaMask signature popup');
    const signed = await handleSiweConfirmation(popup);
    if (!signed) {
      await dismissStalePopup(popup);
    }
    return { signed, method: 'existing-popup' };
  }

  // No popup yet — try wallet.sign() which waits for new popup
  try {
    await ctx.wallet.sign();
    return { signed: true, method: 'wallet.sign()' };
  } catch (e) {
    popup = findMetaMaskPopup(ctx);
    if (popup) {
      const signed = await handleSiweConfirmation(popup);
      if (!signed) {
        await dismissStalePopup(popup);
      }
      return { signed, method: 'fallback-popup' };
    }
    // MetaMask MV3 popup bug — manually open notification.html
    console.log('[WalletTools] handleSignaturePopup: No popup after sign() — trying manual notification.html');
    const manualPage = await openNotificationManually(ctx);
    if (manualPage) {
      const signed = await handleSiweConfirmation(manualPage);
      if (!signed && !manualPage.isClosed()) {
        await manualPage.close().catch(() => {});
      }
      return { signed, method: 'manual-notification' };
    }
    return { signed: false, method: `failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ============================================================================
// Wallet Tool Handlers
// ============================================================================

export async function executeWalletTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: AgentContext
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case 'wallet_approve': {
        const browserContext = ctx.context;
        let siweHandled = false;

        // ============================================================
        // RACE-SAFE CONNECTION APPROVAL
        // MetaMask popup opens instantly when dApp triggers
        // eth_requestAccounts. The popup is likely already open.
        // ============================================================

        let popup = findMetaMaskPopup(ctx);

        if (popup) {
          // Detect what type of popup this is
          const popupType = await detectPopupType(popup);
          console.log(`[WalletTools] wallet_approve: Found existing popup, type=${popupType}`);

          if (popupType === 'connection' || popupType === 'unknown') {
            // Handle connection
            const connected = await handleConnectionPopup(popup);
            if (!connected) {
              console.log('[WalletTools] wallet_approve: handleConnectionPopup returned false');
            }
          } else if (popupType === 'signature') {
            // This is actually a SIWE popup (connection may have already been auto-approved)
            console.log('[WalletTools] wallet_approve: Popup is signature type, handling as SIWE');
            siweHandled = await handleSiweConfirmation(popup);
            if (!siweHandled) {
              await dismissStalePopup(popup);
            }
          }
        } else {
          // No popup — try wallet.approve()
          try {
            console.log('[WalletTools] wallet_approve: No popup found, calling wallet.approve()');
            await ctx.wallet.approve();
          } catch (e) {
            console.log(`[WalletTools] wallet_approve: wallet.approve() failed (${e instanceof Error ? e.message : String(e)}), checking for popup...`);
            popup = findMetaMaskPopup(ctx);
            if (popup) {
              const popupType = await detectPopupType(popup);
              console.log(`[WalletTools] wallet_approve: Found popup after failure, type=${popupType}`);
              if (popupType === 'connection' || popupType === 'unknown') {
                await handleConnectionPopup(popup);
              } else if (popupType === 'signature') {
                siweHandled = await handleSiweConfirmation(popup);
              }
            } else {
              await ctx.page.waitForTimeout(2000);
              popup = findMetaMaskPopup(ctx);
              if (popup) {
                await handleConnectionPopup(popup);
              } else {
                // MetaMask MV3 popup bug: request is queued but popup never auto-opens.
                // Manually open notification.html to access the pending request.
                console.log('[WalletTools] wallet_approve: No popup after retry — trying manual notification.html');
                const manualPage = await openNotificationManually(ctx);
                if (manualPage) {
                  const connected = await handleConnectionPopup(manualPage);
                  if (!connected && !manualPage.isClosed()) {
                    await manualPage.close().catch(() => {});
                  }
                } else {
                  return {
                    success: false,
                    output: `wallet_approve failed: MetaMask popup not found. The dApp may not have triggered eth_requestAccounts. Make sure you clicked the correct "Connect" or "MetaMask" button on the dApp first.`,
                  };
                }
              }
            }
          }
        }

        // Wait for dApp to process connection
        await ctx.page.waitForTimeout(2000);
        await ctx.page.bringToFront();

        // ============================================================
        // AUTO-DETECT SIWE POPUP
        // Privy triggers personal_sign immediately after connection.
        // Strategy: check if popup already open, else use wallet.sign()
        // ============================================================
        if (!siweHandled) {
          await ctx.page.waitForTimeout(1500);

          let siwePopup = findMetaMaskPopup(ctx);

          if (siwePopup) {
            const popupType = await detectPopupType(siwePopup);
            console.log(`[WalletTools] wallet_approve: Post-connect popup found, type=${popupType}`);

            if (popupType === 'signature' || popupType === 'unknown') {
              siweHandled = await handleSiweConfirmation(siwePopup);
              if (!siweHandled) {
                console.log('[WalletTools] wallet_approve: SIWE handling failed, dismissing');
                await dismissStalePopup(siwePopup);
              }
            } else if (popupType === 'connection') {
              // Connection popup still open? Handle it again
              console.log('[WalletTools] wallet_approve: Connection popup still open, handling again');
              await handleConnectionPopup(siwePopup);
              // Then wait for SIWE
              await ctx.page.waitForTimeout(2000);
              siwePopup = findMetaMaskPopup(ctx);
              if (siwePopup) {
                siweHandled = await handleSiweConfirmation(siwePopup);
                if (!siweHandled) {
                  await dismissStalePopup(siwePopup);
                }
              }
            }
          } else {
            // No popup — use wallet.sign() which waits for new popup (preferred path)
            try {
              console.log('[WalletTools] wallet_approve: Waiting for SIWE popup via wallet.sign()');
              await ctx.wallet.sign();
              siweHandled = true;
              console.log('[WalletTools] wallet_approve: SIWE signed via wallet.sign()');
            } catch {
              // wallet.sign() timed out — check one more time
              siwePopup = findMetaMaskPopup(ctx);
              if (siwePopup) {
                console.log('[WalletTools] wallet_approve: SIWE popup found after sign() timeout');
                siweHandled = await handleSiweConfirmation(siwePopup);
                if (!siweHandled) {
                  await dismissStalePopup(siwePopup);
                }
              } else {
                // MetaMask MV3 may have queued SIWE without opening popup — try manual notification.html
                console.log('[WalletTools] wallet_approve: No SIWE popup — trying manual notification.html');
                const manualPage = await openNotificationManually(ctx);
                if (manualPage) {
                  const popupType = await detectPopupType(manualPage);
                  if (popupType === 'signature' || popupType === 'unknown') {
                    siweHandled = await handleSiweConfirmation(manualPage);
                  }
                  if (!manualPage.isClosed()) {
                    await manualPage.close().catch(() => {});
                  }
                }
                // If still no SIWE = genuinely not needed
              }
            }
          }
        }

        if (siweHandled) {
          await ctx.page.waitForTimeout(2000);
        }
        await ctx.page.bringToFront();

        return {
          success: true,
          output: `Wallet connection approved${siweHandled ? ' + SIWE signed automatically' : ''}. Use assert_wallet_connected to verify.`,
        };
      }

      case 'wallet_sign': {
        console.log('[WalletTools] wallet_sign: Handling signature request');
        const result = await handleSignaturePopup(ctx);

        await ctx.page.waitForTimeout(2000);
        await ctx.page.bringToFront();

        if (result.signed) {
          return {
            success: true,
            output: `Message signed via MetaMask (${result.method})`,
          };
        } else {
          return {
            success: false,
            output: `wallet_sign failed: ${result.method}. Make sure the dApp triggered a signature request first.`,
          };
        }
      }

      case 'wallet_confirm_transaction': {
        const txOptions: any = {};
        if (input.gas) txOptions.gas = input.gas as number;
        if (input.gasLimit) txOptions.gasLimit = input.gasLimit as number;

        let popup = findMetaMaskPopup(ctx);

        if (popup) {
          console.log('[WalletTools] wallet_confirm_transaction: Found existing popup, clicking confirm');
          await popup.bringToFront();
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          await popup.waitForTimeout(1000);

          let confirmed = false;
          try {
            // MetaMask v13.17 transaction confirm buttons
            const confirmBtn = popup.getByTestId('confirm-footer-button')
              .or(popup.getByTestId('confirm-btn'))
              .or(popup.locator('button:has-text("Confirm")').first())
              .or(popup.locator('button.btn-primary').first());
            await confirmBtn.click({ timeout: 5000 });
            confirmed = true;
          } catch {
            try {
              await ctx.wallet.confirmTransaction(Object.keys(txOptions).length > 0 ? txOptions : undefined);
              confirmed = true;
            } catch {
              await dismissStalePopup(popup);
              await ctx.page.bringToFront();
              return {
                success: false,
                output: 'wallet_confirm_transaction failed: could not find confirm button. Stale popup dismissed.',
              };
            }
          }

          if (confirmed && !popup.isClosed()) {
            await popup.waitForEvent('close', { timeout: 30000 }).catch(() => {});
          }
        } else {
          await ctx.wallet.confirmTransaction(Object.keys(txOptions).length > 0 ? txOptions : undefined);
        }

        await ctx.page.waitForTimeout(3000);
        await ctx.page.bringToFront();
        return {
          success: true,
          output: 'Transaction confirmed via MetaMask',
        };
      }

      case 'wallet_switch_network': {
        const networkName = input.networkName as string;

        // Map network names to expected chain IDs for verification
        const networkChainIds: Record<string, number> = {
          'Base': 8453,
          'Arbitrum One': 42161,
          'OP Mainnet': 10,
          'Polygon Mainnet': 137,
          'Avalanche Network C-Chain': 43114,
          'BNB Smart Chain': 56,
          'Ethereum Mainnet': 1,
        };

        await ctx.wallet.switchNetwork(networkName);
        await ctx.page.bringToFront();
        await ctx.page.waitForTimeout(3000);

        // Force the page provider to sync (MetaMask MV3 may not fire chainChanged)
        const expectedHex = '0x' + networkChainIds[networkName]?.toString(16);
        try {
          await ctx.page.evaluate(async (targetChainId: string) => {
            await (window as any).ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: targetChainId }],
            });
          }, expectedHex);
          console.log(`[WalletTools] wallet_switch_network: Forced page provider sync to ${expectedHex}`);
          await ctx.page.waitForTimeout(2000);
        } catch (e) {
          console.log(`[WalletTools] wallet_switch_network: Page-side switch failed (may need popup): ${e}`);
          await ctx.page.waitForTimeout(2000);
        }
        if (networkChainIds[networkName]) {
          let verified = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const currentHex = await ctx.page.evaluate(async () => {
                const eth = (window as any).ethereum;
                // Active RPC call — bypasses cached chainId property
                const rpc = await eth?.request?.({ method: 'eth_chainId' });
                return rpc || eth?.chainId || null;
              });
              if (currentHex === expectedHex) {
                console.log(`[WalletTools] wallet_switch_network: Verified chain ${currentHex} matches ${networkName}`);
                verified = true;
                break;
              }
              console.log(`[WalletTools] wallet_switch_network: Chain ${currentHex} != ${expectedHex}, polling (${attempt + 1}/5)...`);
            } catch (e) {
              console.log(`[WalletTools] wallet_switch_network: Poll error: ${e}`);
            }
            await ctx.page.waitForTimeout(2000);
          }
          if (!verified) {
            console.log(`[WalletTools] wallet_switch_network: Chain did not update to ${expectedHex} after polling, but MetaMask switch succeeded`);
          }
        }

        return {
          success: true,
          output: `Switched network to "${networkName}". Page NOT reloaded (dApp handles chainChanged event automatically).`,
        };
      }

      case 'wallet_handle_siwe_popup': {
        const browserContext = ctx.context;
        const existingPopup = findMetaMaskPopup(ctx);

        if (existingPopup) {
          const handled = await handleSiweConfirmation(existingPopup);
          if (handled) {
            await ctx.page.bringToFront();
            await ctx.page.waitForTimeout(2000);
            return {
              success: true,
              output: 'SIWE popup found and signed (existing popup)',
            };
          } else {
            await dismissStalePopup(existingPopup);
          }
        }

        // Wait for new popup
        try {
          const popup = await browserContext.waitForEvent('page', { timeout: 10000 });
          if (popup.url().includes('notification')) {
            const handled = await handleSiweConfirmation(popup);
            if (handled) {
              await ctx.page.bringToFront();
              await ctx.page.waitForTimeout(2000);
              return {
                success: true,
                output: 'SIWE popup appeared and signed (new popup)',
              };
            }
          }
        } catch {
          try {
            await ctx.wallet.sign();
            await ctx.page.bringToFront();
            await ctx.page.waitForTimeout(2000);
            return {
              success: true,
              output: 'SIWE handled via wallet.sign() fallback',
            };
          } catch {
            // May have already completed
          }
        }

        await ctx.page.bringToFront();
        return {
          success: true,
          output: 'SIWE popup handling completed (may have already been signed or not triggered)',
        };
      }

      case 'wallet_reject': {
        await ctx.wallet.reject();
        await ctx.page.waitForTimeout(1000);
        await ctx.page.bringToFront();
        return {
          success: true,
          output: 'Rejected pending MetaMask request',
        };
      }

      default:
        return { success: false, output: `Unknown wallet tool: ${toolName}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, output: `Tool ${toolName} failed: ${message}` };
  }
}
