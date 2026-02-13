import type { Page, Locator } from 'playwright-core';
import type { ToolDefinition, ToolCallResult, AgentContext } from '../types.js';
import { captureSnapshot } from '../snapshot-serializer.js';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Browser Tool Definitions (for Claude API)
// ============================================================================

export const browserToolDefinitions: ToolDefinition[] = [
  {
    name: 'browser_snapshot',
    description: 'Capture the current page accessibility snapshot. Returns a text representation of all visible elements with refs you can use in other tools. Always call this before interacting with elements to get current refs.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element identified by its ref from the accessibility snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot (e.g., "e5")' },
        description: { type: 'string', description: 'What you are clicking and why' },
      },
      required: ['ref', 'description'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into a text input element identified by its ref. This clears the field first, then types the new value.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from snapshot (e.g., "e12")' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Whether to clear the field first (default: true)' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a dropdown/combobox by its visible text.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Combobox/select ref from snapshot' },
        value: { type: 'string', description: 'Option text to select' },
      },
      required: ['ref', 'value'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page in a direction.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Pixels to scroll (default: 500)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a condition: specific text to appear, or a fixed timeout.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to wait for on the page' },
        timeout: { type: 'number', description: 'Max wait time in ms (default: 10000)' },
        sleep: { type: 'number', description: 'Fixed sleep in ms (use instead of text)' },
      },
    },
  },
  {
    name: 'browser_go_back',
    description: 'Navigate back in browser history.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Evaluate a JavaScript expression in the page context. Returns the result as a string.',
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate (e.g., "document.title" or "window.ethereum?.selectedAddress")' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g., "Enter", "Escape", "Tab", "ArrowDown")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page. Use this for artifact collection or to visually verify page state.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Descriptive name for the screenshot (e.g., "after-connect")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'assert_wallet_connected',
    description: 'Assert that the wallet is connected by checking window.ethereum.selectedAddress. Returns the connected address or fails.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ============================================================================
// Browser Tool Handlers
// ============================================================================

async function resolveRef(ctx: AgentContext, ref: string): Promise<string> {
  const node = ctx.snapshotRefs.get(ref);
  if (!node) {
    throw new Error(`Element ref "${ref}" not found in current snapshot. Take a new snapshot first.`);
  }
  return node.locatorStrategy;
}

async function getLocator(page: Page, locatorStrategy: string) {
  // locatorStrategy is like: getByRole('button', { name: "Connect" })
  // We need to evaluate it against the page
  if (locatorStrategy.startsWith('getByRole')) {
    const match = locatorStrategy.match(/getByRole\('([^']+)'(?:,\s*\{\s*name:\s*("(?:[^"\\]|\\.)*")\s*\})?\)/);
    if (match) {
      const role = match[1];
      const name = match[2] ? JSON.parse(match[2]) : undefined;
      if (name) {
        return page.getByRole(role as any, { name, exact: false });
      }
      return page.getByRole(role as any);
    }
  }
  // Fallback: use as CSS selector
  return page.locator(locatorStrategy);
}

/**
 * Highlight an element with a red outline and take a screenshot.
 * Returns the screenshot filename or undefined if it fails.
 */
async function highlightAndScreenshot(
  page: Page,
  locator: Locator,
  ctx: AgentContext,
  actionDesc: string
): Promise<string | undefined> {
  try {
    if (!existsSync(ctx.artifactsDir)) {
      mkdirSync(ctx.artifactsDir, { recursive: true });
    }
    await locator.first().evaluate((el: HTMLElement) => {
      el.style.outline = '3px solid #ef4444';
      el.style.outlineOffset = '2px';
      el.style.boxShadow = '0 0 12px rgba(239,68,68,0.5)';
    });
    const safeName = `action-${ctx.screenshotCounter}-${actionDesc.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`;
    ctx.screenshotCounter++;
    const filePath = join(ctx.artifactsDir, `${safeName}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    await locator.first().evaluate((el: HTMLElement) => {
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.boxShadow = '';
    });
    return `${safeName}.png`;
  } catch {
    return undefined;
  }
}

export async function executeBrowserTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: AgentContext
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case 'browser_snapshot': {
        const { text, refs } = await captureSnapshot(ctx.page);
        // Update context refs
        ctx.snapshotRefs = refs;
        return { success: true, output: text };
      }

      case 'browser_click': {
        const ref = input.ref as string;
        const locatorStr = await resolveRef(ctx, ref);
        const locator = await getLocator(ctx.page, locatorStr);
        const node = ctx.snapshotRefs.get(ref)!;

        const screenshotBefore = await highlightAndScreenshot(
          ctx.page, locator, ctx, `click-${node.name || ref}`
        );

        await locator.first().click({ timeout: 10000 });
        return {
          success: true,
          output: `Clicked ${node.role} "${node.name}" [${ref}]`,
          _screenshotBefore: screenshotBefore,
        };
      }

      case 'browser_type': {
        const ref = input.ref as string;
        const text = input.text as string;
        const clear = input.clear !== false;
        const locatorStr = await resolveRef(ctx, ref);
        const locator = await getLocator(ctx.page, locatorStr);

        const screenshotBefore = await highlightAndScreenshot(
          ctx.page, locator, ctx, `type-${ref}`
        );

        if (clear) {
          await locator.first().clear({ timeout: 5000 });
        }
        await locator.first().fill(text, { timeout: 5000 });
        return {
          success: true,
          output: `Typed "${text}" into [${ref}]`,
          _screenshotBefore: screenshotBefore,
        };
      }

      case 'browser_select': {
        const ref = input.ref as string;
        const value = input.value as string;
        const locatorStr = await resolveRef(ctx, ref);
        const locator = await getLocator(ctx.page, locatorStr);

        await locator.first().selectOption({ label: value }, { timeout: 5000 });
        return {
          success: true,
          output: `Selected "${value}" in [${ref}]`,
        };
      }

      case 'browser_navigate': {
        const url = input.url as string;
        await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await ctx.page.waitForTimeout(2000);
        return {
          success: true,
          output: `Navigated to ${url}`,
        };
      }

      case 'browser_scroll': {
        const direction = input.direction as string;
        const amount = (input.amount as number) || 500;
        const delta = direction === 'down' ? amount : -amount;
        await ctx.page.mouse.wheel(0, delta);
        await ctx.page.waitForTimeout(500);
        return {
          success: true,
          output: `Scrolled ${direction} by ${amount}px`,
        };
      }

      case 'browser_wait': {
        if (input.sleep) {
          const ms = input.sleep as number;
          await ctx.page.waitForTimeout(Math.min(ms, 30000));
          return { success: true, output: `Waited ${ms}ms` };
        }
        if (input.text) {
          const text = input.text as string;
          const timeout = (input.timeout as number) || 10000;
          await ctx.page.getByText(text, { exact: false }).first().waitFor({
            state: 'visible',
            timeout,
          });
          return { success: true, output: `Text "${text}" appeared on page` };
        }
        return { success: true, output: 'No wait condition specified' };
      }

      case 'browser_go_back': {
        await ctx.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
        await ctx.page.waitForTimeout(1000);
        return { success: true, output: 'Navigated back' };
      }

      case 'browser_evaluate': {
        const expression = input.expression as string;
        const result = await ctx.page.evaluate((expr) => {
          try {
            return String(eval(expr));
          } catch (e) {
            return `Error: ${e}`;
          }
        }, expression);
        return { success: true, output: `Result: ${result}` };
      }

      case 'browser_press_key': {
        const key = input.key as string;
        await ctx.page.keyboard.press(key);
        return { success: true, output: `Pressed key: ${key}` };
      }

      case 'browser_screenshot': {
        const name = (input.name as string) || `screenshot-${ctx.screenshotCounter}`;
        ctx.screenshotCounter++;

        if (!existsSync(ctx.artifactsDir)) {
          mkdirSync(ctx.artifactsDir, { recursive: true });
        }

        // Filter to dApp pages only (skip MetaMask extension pages)
        const pages = ctx.context.pages();
        const dappPage = pages.find(
          (p) => !p.url().startsWith('chrome-extension://') && p.url() !== 'about:blank' && !p.isClosed()
        ) || ctx.page;

        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filePath = join(ctx.artifactsDir, `${safeName}.png`);

        await dappPage.screenshot({ path: filePath, fullPage: false });

        return {
          success: true,
          output: `Screenshot saved: ${safeName}.png`,
        };
      }

      case 'assert_wallet_connected': {
        const address = await ctx.page.evaluate(() => {
          const eth = (window as any).ethereum;
          return eth?.selectedAddress || eth?.accounts?.[0] || null;
        });

        if (address && typeof address === 'string' && address.toLowerCase().startsWith('0x')) {
          return {
            success: true,
            output: `Wallet connected: ${address}`,
          };
        }
        return {
          success: false,
          output: `Wallet NOT connected. ethereum.selectedAddress = ${address}`,
        };
      }

      default:
        return { success: false, output: `Unknown browser tool: ${toolName}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, output: `Tool ${toolName} failed: ${message}` };
  }
}
