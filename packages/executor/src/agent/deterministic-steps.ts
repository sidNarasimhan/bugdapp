import type { Page } from 'playwright-core';
import type { IntentStep, AgentContext, AgentStepData, AgentAction } from './types.js';
import { join } from 'path';

/**
 * Steps that can be executed deterministically without calling Claude.
 * This saves API calls (and $$$) for steps with known, fixed execution paths.
 */
const DETERMINISTIC_TYPES = new Set([
  'navigate',
  'switch_network',
  'verify_state',
]);

/**
 * Check if a step can be executed without Claude.
 */
export function isDeterministicStep(step: IntentStep): boolean {
  return DETERMINISTIC_TYPES.has(step.type);
}

/**
 * Network name → chain ID mapping for verification.
 */
const NETWORK_CHAIN_IDS: Record<string, number> = {
  'Base': 8453,
  'Arbitrum One': 42161,
  'OP Mainnet': 10,
  'Polygon Mainnet': 137,
  'Avalanche Network C-Chain': 43114,
  'BNB Smart Chain': 56,
  'Ethereum Mainnet': 1,
};

/**
 * Execute a deterministic step without Claude.
 * Returns the same AgentStepData shape as the agent loop.
 */
export async function executeDeterministicStep(
  step: IntentStep,
  stepIdx: number,
  totalSteps: number,
  ctx: AgentContext,
): Promise<AgentStepData> {
  const startTime = Date.now();
  const actions: AgentAction[] = [];

  console.log(`[Deterministic] Step ${stepIdx + 1}/${totalSteps}: ${step.description} (no AI needed)`);

  try {
    switch (step.type) {
      case 'navigate': {
        const url = step.context?.url as string || extractUrlFromDescription(step.description);
        if (!url) {
          return makeResult(step, 'failed', actions, startTime, undefined, 'No URL found in step context or description');
        }

        // Navigate
        await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        actions.push(makeAction('browser_navigate', { url }, `Navigated to ${url}`, true, Date.now() - startTime));

        // Wait for page to stabilize
        await ctx.page.waitForTimeout(3000);
        actions.push(makeAction('browser_wait', { sleep: 3000 }, 'Waited 3000ms', true, 3000));

        // Screenshot
        await captureStepScreenshot(ctx, step, stepIdx);

        const title = await ctx.page.title();
        const summary = `Navigated to ${url}. Page title: "${title}"`;
        console.log(`[Deterministic]   -> ${summary}`);
        return makeResult(step, 'passed', actions, startTime, summary);
      }

      case 'switch_network': {
        const networkName = step.context?.networkName as string || extractNetworkFromDescription(step.description);
        if (!networkName) {
          return makeResult(step, 'failed', actions, startTime, undefined, 'No network name found in step context or description');
        }

        const expectedChainId = NETWORK_CHAIN_IDS[networkName];

        // Strategy 1: Use wallet_switchEthereumChain via the provider (most reliable)
        if (expectedChainId) {
          try {
            const hexChainId = '0x' + expectedChainId.toString(16);
            console.log(`[Deterministic]   Switching to ${networkName} (${hexChainId}) via provider RPC`);

            // Request network switch via ethereum provider — MetaMask auto-approves built-in networks
            await ctx.page.evaluate(async (chainIdHex: string) => {
              await (window as any).ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: chainIdHex }],
              });
            }, hexChainId);

            await ctx.page.waitForTimeout(3000);
            actions.push(makeAction('wallet_switch_network', { networkName, method: 'provider_rpc' }, `Switch requested via provider`, true, Date.now() - startTime));
          } catch (providerErr) {
            console.log(`[Deterministic]   Provider RPC switch failed: ${providerErr}, trying dappwright`);

            // Strategy 2: Fall back to dappwright switchNetwork
            try {
              await ctx.wallet.switchNetwork(networkName);
              await ctx.page.bringToFront();
              await ctx.page.waitForTimeout(3000);
              actions.push(makeAction('wallet_switch_network', { networkName, method: 'dappwright' }, `Switch requested via dappwright`, true, Date.now() - startTime));
            } catch (dappwrightErr) {
              console.log(`[Deterministic]   dappwright switch also failed: ${dappwrightErr}`);
              return makeResult(step, 'failed', actions, startTime, undefined,
                `Network switch failed via both provider and dappwright: ${providerErr}`);
            }
          }
        } else {
          // Unknown chain ID — try dappwright only
          try {
            await ctx.wallet.switchNetwork(networkName);
            await ctx.page.bringToFront();
            await ctx.page.waitForTimeout(3000);
            actions.push(makeAction('wallet_switch_network', { networkName, method: 'dappwright' }, `Switch requested via dappwright`, true, Date.now() - startTime));
          } catch (e) {
            return makeResult(step, 'failed', actions, startTime, undefined, `Network switch failed: ${e}`);
          }
        }

        // Verify chain ID
        if (expectedChainId) {
          try {
            const currentChainId = await ctx.page.evaluate(() => {
              const eth = (window as any).ethereum;
              if (eth?.chainId) return parseInt(eth.chainId, 16);
              return null;
            });
            if (currentChainId && currentChainId !== expectedChainId) {
              console.log(`[Deterministic]   Chain mismatch: expected ${expectedChainId}, got ${currentChainId}`);
              return makeResult(step, 'failed', actions, startTime, undefined,
                `Network switch failed. Expected chain ${expectedChainId} (${networkName}) but got ${currentChainId}`);
            }
            console.log(`[Deterministic]   Verified chain ID: ${currentChainId}`);
            actions.push(makeAction('verify_chain', { expected: expectedChainId, actual: currentChainId }, `Chain ${currentChainId} verified`, true, 0));
          } catch (e) {
            console.log(`[Deterministic]   Could not verify chain ID: ${e}`);
          }
        }

        await captureStepScreenshot(ctx, step, stepIdx);

        const summary = `Switched network to ${networkName}`;
        console.log(`[Deterministic]   -> ${summary}`);
        return makeResult(step, 'passed', actions, startTime, summary);
      }

      case 'verify_state': {
        // Check wallet connection via window.ethereum
        const result = await ctx.page.evaluate(() => {
          const eth = (window as any).ethereum;
          if (!eth) return { connected: false, address: null, error: 'No ethereum provider' };
          const addr = eth.selectedAddress;
          return { connected: !!addr, address: addr, error: addr ? null : 'selectedAddress is null' };
        });

        actions.push(makeAction('assert_wallet_connected', {},
          result.connected ? `Connected: ${result.address}` : `NOT connected: ${result.error}`,
          result.connected, Date.now() - startTime));

        await captureStepScreenshot(ctx, step, stepIdx);

        if (result.connected) {
          const summary = `Wallet connected: ${result.address}`;
          console.log(`[Deterministic]   -> ${summary}`);
          return makeResult(step, 'passed', actions, startTime, summary);
        } else {
          const error = `Wallet NOT connected: ${result.error}`;
          console.log(`[Deterministic]   -> FAIL: ${error}`);
          return makeResult(step, 'failed', actions, startTime, undefined, error);
        }
      }

      default:
        return makeResult(step, 'failed', actions, startTime, undefined, `Unhandled deterministic step type: ${step.type}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Deterministic]   Error: ${msg}`);
    return makeResult(step, 'failed', actions, startTime, undefined, msg);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractUrlFromDescription(desc: string): string | undefined {
  const match = desc.match(/https?:\/\/[^\s]+/);
  return match?.[0];
}

function extractNetworkFromDescription(desc: string): string | undefined {
  const networks = ['Base', 'Arbitrum One', 'OP Mainnet', 'Polygon Mainnet', 'Avalanche Network C-Chain', 'BNB Smart Chain', 'Ethereum Mainnet'];
  const lower = desc.toLowerCase();
  for (const net of networks) {
    if (lower.includes(net.toLowerCase())) return net;
  }
  return undefined;
}

function makeAction(
  tool: string,
  input: Record<string, unknown>,
  output: string,
  success: boolean,
  durationMs: number,
): AgentAction {
  return { tool, input, output, success, durationMs };
}

function makeResult(
  step: IntentStep,
  status: 'passed' | 'failed',
  actions: AgentAction[],
  startTime: number,
  summary?: string,
  error?: string,
): AgentStepData {
  return {
    stepId: step.id,
    description: step.description,
    status,
    summary,
    error,
    apiCalls: 0, // No Claude calls!
    durationMs: Date.now() - startTime,
    actions,
  };
}

async function captureStepScreenshot(ctx: AgentContext, step: IntentStep, stepIdx: number): Promise<void> {
  try {
    const screenshotPath = join(ctx.artifactsDir, `step-${stepIdx + 1}-${step.type}.png`);
    await ctx.page.screenshot({ path: screenshotPath, fullPage: false });
  } catch {
    // Non-fatal
  }
}
