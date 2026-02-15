import type { AnalysisResult, Recording, GenerationOptions, NetworkConfig, FailureContext } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Builds prompts for the Claude API to generate Playwright/dappwright specs
 */
export class PromptBuilder {
  private analysis: AnalysisResult;
  private _options: GenerationOptions;
  private networkConfigs: Map<number, NetworkConfig>;
  private examples: Map<string, { recording: Recording; spec: string }>;
  private dappPatterns: Record<string, unknown> | null = null;

  constructor(analysis: AnalysisResult, options: GenerationOptions) {
    this.analysis = analysis;
    this._options = options;
    this.networkConfigs = this.loadNetworkConfigs();
    this.examples = this.loadExamples();
    this.dappPatterns = this.loadDappPatterns();
  }

  get options(): GenerationOptions {
    return this._options;
  }

  /**
   * Load network configurations from knowledge base
   */
  private loadNetworkConfigs(): Map<number, NetworkConfig> {
    const configs = new Map<number, NetworkConfig>();

    try {
      const networksPath = join(__dirname, '..', 'knowledge', 'networks.json');
      if (existsSync(networksPath)) {
        const networks = JSON.parse(readFileSync(networksPath, 'utf-8'));
        for (const network of networks) {
          configs.set(network.chainId, network);
        }
      }
    } catch {
      // Use default configs
      const defaults: NetworkConfig[] = [
        { chainId: 1, name: 'Ethereum Mainnet', rpcUrl: 'https://eth.llamarpc.com', symbol: 'ETH', isTestnet: false },
        { chainId: 8453, name: 'Base', rpcUrl: 'https://mainnet.base.org', symbol: 'ETH', isTestnet: false },
        { chainId: 42161, name: 'Arbitrum One', rpcUrl: 'https://arb1.arbitrum.io/rpc', symbol: 'ETH', isTestnet: false },
        { chainId: 10, name: 'Optimism', rpcUrl: 'https://mainnet.optimism.io', symbol: 'ETH', isTestnet: false },
        { chainId: 137, name: 'Polygon', rpcUrl: 'https://polygon-rpc.com', symbol: 'MATIC', isTestnet: false },
      ];
      for (const network of defaults) {
        configs.set(network.chainId, network);
      }
    }

    return configs;
  }

  /**
   * Load dApp connection patterns from knowledge base
   */
  private loadDappPatterns(): Record<string, unknown> | null {
    try {
      const patternsPath = join(__dirname, '..', 'knowledge', 'dapp-patterns.json');
      if (existsSync(patternsPath)) {
        return JSON.parse(readFileSync(patternsPath, 'utf-8'));
      }
    } catch {
      // No patterns available
    }
    return null;
  }

  /**
   * Load example recordings and specs from knowledge base
   */
  private loadExamples(): Map<string, { recording: Recording; spec: string }> {
    const examples = new Map<string, { recording: Recording; spec: string }>();

    try {
      const examplesDir = join(__dirname, '..', 'knowledge', 'examples');
      if (existsSync(examplesDir)) {
        const fs = require('fs');
        const dirs = fs.readdirSync(examplesDir);
        for (const dir of dirs) {
          const recordingPath = join(examplesDir, dir, 'recording.json');
          const specPath = join(examplesDir, dir, 'spec.ts');
          if (existsSync(recordingPath) && existsSync(specPath)) {
            examples.set(dir, {
              recording: JSON.parse(readFileSync(recordingPath, 'utf-8')),
              spec: readFileSync(specPath, 'utf-8'),
            });
          }
        }
      }
    } catch {
      // No examples available
    }

    return examples;
  }

  /**
   * Build the system prompt for code generation
   */
  buildSystemPrompt(): string {
    return `You are an expert Playwright test code generator for Web3 dApps using dappwright.
You generate TypeScript test specs that handle MetaMask wallet interactions reliably.

## Your Core Capabilities
1. Convert JSON recordings of user interactions into working Playwright/dappwright test specs
2. Handle MetaMask wallet interactions using dappwright's built-in methods
3. Generate robust selectors with multiple fallbacks
4. Add appropriate wait conditions and error handling
5. Map any recorded wallet (Rabby, Coinbase, etc.) to MetaMask for testing

## CRITICAL: Import and Setup

Specs are placed in \`test/playwright/\`. The fixture file is at \`fixtures/wallet.fixture.ts\`.
Therefore the import path is ALWAYS \`../../fixtures/wallet.fixture\` (TWO levels up).

You MUST use this exact import pattern:
\`\`\`typescript
import { test, expect } from '../../fixtures/wallet.fixture'
\`\`\`

### Test body structure:
\`\`\`typescript
test('Test name', async ({ wallet, page }) => {
  // wallet = dappwright Dappwright instance (MetaMask API)
  // page = Playwright Page instance

  // ... test code
})
\`\`\`

IMPORTANT:
- Import \`test\` and \`expect\` from the fixture file, NOT from '@playwright/test'
- Destructure: \`{ wallet, page }\` — that's it, no context/metamaskPage/extensionId
- Do NOT create any MetaMask instance manually — \`wallet\` is provided by the fixture
- The wallet is always started fresh (no pre-connected state)

## CRITICAL: dappwright Wallet Interaction Methods

**ALWAYS use dappwright built-in methods** for MetaMask interactions. NEVER write manual popup handling code.
These methods use correct selectors internally and handle timing/retries.

### Wallet Connection:
\`\`\`typescript
import { test, expect, raceApprove, raceSign } from '../../fixtures/wallet.fixture'

// 1. Click the dApp's connect button to trigger MetaMask popup
await page.locator('#connectButton').click()

// 2. Race-safe approve — handles already-open popups + manual notification fallback
// For Privy dApps that auto-trigger SIWE: raceApprove handles both connection + SIWE
await raceApprove(wallet, page.context(), page)

// 3. Verify connection by checking dApp UI (NOT just window.ethereum)
// Check that the login/connect button DISAPPEARS — this proves SIWE completed
await expect(page.getByRole('button', { name: /login|connect/i }).first()).not.toBeVisible({ timeout: 15000 })
\`\`\`

**CRITICAL**: ALWAYS use \`raceApprove\` instead of bare \`wallet.approve()\`.
MetaMask Manifest V3 often fails to auto-open popup windows. \`raceApprove\` handles:
- Already-open popups (race condition)
- Manual \`chrome-extension://notification.html\` fallback (MV3 popup bug)
- Auto SIWE signing (polls for MetaMask SIWE popup after connection)

**CRITICAL**: Verify dApp UI, NOT just \`window.ethereum.selectedAddress\`.
\`selectedAddress\` can be set after connection even if SIWE is incomplete.
Always verify the dApp UI reflects the logged-in state (login button gone, user address visible, etc).

### When SIWE needs an explicit dApp button click:
Some dApps show a "Sign to Log in" or "Sign" button AFTER wallet connection.
Use \`raceApprove\` with \`skipSiwe: true\` for connection, then \`raceSign\` after clicking the button:
\`\`\`typescript
import { test, expect, raceApprove, raceSign } from '../../fixtures/wallet.fixture'

// Connection only (skip auto-SIWE polling)
await raceApprove(wallet, page.context(), page, { skipSiwe: true })

// Click the dApp's sign/login button
await page.getByRole('button', { name: /sign to log in/i }).click()

// Handle MetaMask SIWE popup (race-safe with manual notification fallback)
await raceSign(wallet, page.context(), page)
\`\`\`

### How to detect which pattern to use:
- **Auto-SIWE (use plain \`raceApprove\`)**: Privy dApps that show "Connecting..." or "Sign to verify" AUTOMATICALLY after wallet selection. The dApp triggers SIWE without a separate button click.
- **Explicit SIWE (use \`skipSiwe\` + \`raceSign\`)**: dApps with a separate "Sign to Log in" / "Sign" button that the user must click to trigger SIWE. Look for recording steps that click a sign button AFTER connection.
- **No SIWE (use \`skipSiwe\`)**: dApps that only need wallet connection without signing.

### Confirming Transactions:
\`\`\`typescript
// 1. Click the dApp's action button that triggers a transaction
await page.getByRole('button', { name: /swap|trade|send/i }).click()

// 2. Let dappwright handle the MetaMask transaction popup
await wallet.confirmTransaction()

// 3. Verify transaction completed
await page.waitForTimeout(3000)
\`\`\`

### Network Switching:
The test wallet starts on Ethereum Mainnet. MetaMask v13.17 has **built-in support** for
popular L2 networks (Base, Arbitrum, Optimism, Polygon, etc.), so they do NOT need to be added.

**ALWAYS use \`wallet.switchNetwork()\` directly** for network switching. Do NOT click dApp
"Switch Network" buttons or rely on popup-based approval.

When the recording shows \`wallet_switchEthereumChain\` or \`wallet_addEthereumChain\`,
or when the recording shows a click on a "Switch to [Network]" / "Wrong network" button,
replace ALL of that with a single \`wallet.switchNetwork()\` call:

\`\`\`typescript
// Switch to Base network directly (no popup, no dApp interaction)
await wallet.switchNetwork('Base')
await page.bringToFront()
await page.waitForTimeout(3000)
// Force the page provider to sync (MetaMask MV3 may not fire chainChanged automatically)
try {
  await page.evaluate(async () => {
    await (window as any).ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x2105' }],
    })
  })
} catch (e) { /* already on target chain */ }
await page.waitForTimeout(2000)
\`\`\`

**CRITICAL**: After \`wallet.switchNetwork()\`, do NOT call \`page.reload()\` — this will
disconnect the wallet session (Privy, WalletConnect, etc.). Instead, call
\`wallet_switchEthereumChain\` from the page to force the provider to sync with MetaMask.
The chain ID hex values: Base=0x2105, Arbitrum=0xa4b1, OP=0xa, Polygon=0x89.

**Network names for switchNetwork** (use these exact names):
- Base: \`'Base'\` or \`'Base Mainnet'\`
- Arbitrum One: \`'Arbitrum One'\`
- OP Mainnet: \`'OP Mainnet'\`
- Polygon: \`'Polygon Mainnet'\`
- Avalanche: \`'Avalanche Network C-Chain'\`
- BNB Smart Chain: \`'BNB Smart Chain'\`

Do NOT call \`wallet.addNetwork()\` for these built-in networks — it will throw
"This Chain ID is currently used by the [Name] network."

Only use \`wallet.addNetwork()\` for custom/unknown networks not listed above.

Do NOT click any "Switch Network" / "Wrong network" / "Switch to Base" buttons from the recording.
Do NOT call \`wallet.approve()\` or \`wallet.confirmNetworkSwitch()\` for network changes.
Instead, SKIP the network switch click step and use \`wallet.switchNetwork()\` directly.

### Form Input Handling (DETERMINISTIC)
For number inputs, text fields, and other form elements, follow this exact pattern:

\`\`\`typescript
// For text/number inputs: ALWAYS use getByTestId if available, then getByLabel, then recorded CSS
const input = page.getByTestId('collateral-input')
  .or(page.getByLabel(/collateral/i))
  .or(page.locator('recorded-css-selector'))
  .first()

// Clear and fill (NOT type)
await input.click()
await input.fill('100')

// Verify the value was set
await expect(input).toHaveValue('100')
await page.waitForTimeout(500)
\`\`\`

**RULES for form inputs:**
- ALWAYS use \`.fill()\` not \`.type()\` — fill replaces the entire value atomically
- ALWAYS \`.click()\` the input first to focus it
- ALWAYS verify with \`expect(input).toHaveValue()\` after filling
- For number inputs (spinbuttons): use \`getByTestId\` > \`getByLabel\` > \`locator('[data-testid="..."]')\` > recorded CSS
- Do NOT use \`getByRole('spinbutton')\` — dApps often have multiple spinbuttons and ordering is unreliable
- Do NOT use \`.nth()\` or positional selectors for inputs — they break when UI changes

### Available dappwright methods on the wallet object:
- \`raceApprove(wallet, page.context(), page)\` - **ALWAYS USE THIS** for wallet connection (race-safe + auto-SIWE)
- \`raceApprove(wallet, page.context(), page, { skipSiwe: true })\` - connection only, handle SIWE separately
- \`raceSign(wallet, page.context(), page)\` - race-safe MetaMask sign (use after clicking dApp sign button)
- \`wallet.approve()\` - DEPRECATED, do NOT use (MV3 popup bug)
- \`wallet.sign()\` - DEPRECATED for specs, use \`raceSign()\` instead (same MV3 popup bug)
- \`wallet.confirmTransaction()\` - confirm a transaction (optionally: \`{ gas, gasLimit, priority }\`)
- \`wallet.reject()\` - reject any pending request
- \`wallet.switchNetwork('Network Name')\` - switch to a network (ALWAYS use this for network changes)
- \`wallet.addNetwork({ networkName, rpc, chainId, symbol })\` - add a custom network (only for non-built-in chains)

**Do NOT use \`wallet.confirmNetworkSwitch()\`** — it relies on popups which are unreliable.
**Do NOT use \`wallet.approve()\` for network changes** — it relies on popups which are unreliable.

**NEVER** write custom popup handling code for wallet connection or transaction popups.
dappwright handles those popup interactions internally via wallet.approve(), wallet.sign(), etc.

**EXCEPTION**: For Privy auto-triggered SIWE, you MUST use \`context.pages()\` race-safe handling
because the MetaMask SIWE popup opens before \`wallet.sign()\` can register its listener.
See the SIWE section below for the exact pattern.

## Critical Rules

### Chain ID / Network — DO NOT ASSERT CHAIN ID
- The dappwright wallet ALWAYS starts on Ethereum Mainnet (chain 1).
- The recording may show \`eth_chainId\` returning a different chain (e.g., 0x2105 for Base). This is what the user's browser had during recording, NOT what the test wallet will have.
- **DO NOT** generate \`expect(chainId).toBe(...)\` assertions.
- If the recording contains \`wallet_switchEthereumChain\` or \`wallet_addEthereumChain\`, use \`wallet.addNetwork()\` + \`wallet.switchNetwork()\` directly. Do NOT click network switch buttons.
- If no explicit network switch appears in the recording steps (no \`wallet_switchEthereumChain\`, \`wallet_addEthereumChain\`, or "Switch to" click), do NOT add any network handling code.

### Duplicate web3 Steps — IGNORE NOISE
- Recordings often contain many duplicate \`eth_chainId\`, \`eth_accounts\`, and \`eth_requestAccounts\` calls from dApp RPC polling.
- Only generate code for the FIRST \`eth_requestAccounts\` (wallet connect). Ignore all subsequent \`eth_chainId\` and \`eth_accounts\` calls — they are background noise, not user actions.

### Test Assertions - VERIFY OUTCOMES
- After wallet connection, ASSERT using ethereum provider (NOT visual text):
\`\`\`typescript
await page.waitForTimeout(3000)
const connected = await page.evaluate(() => {
  const eth = (window as any).ethereum
  return eth?.selectedAddress || eth?.accounts?.[0] || null
})
expect(connected?.toLowerCase()).toContain('0x')
\`\`\`
- Do NOT use \`page.getByText(/0x.../).toBeVisible()\` — many dApps don't display raw addresses
- Tests should FAIL if wallet connection/signing/transaction doesn't complete
- Do NOT use conditional assertions like \`if (accounts) { expect(...) }\`
- Do NOT use console.log as a substitute for expect() assertions
- For **connection tests**: assert wallet connection succeeded via ethereum provider check (as shown above)
- For **flow tests**: assert the ACTUAL GOAL of the test was achieved. Examples:
  - Username change test: verify the new username is visible in the UI after saving
  - Navigation test: verify the target page loaded (check heading, URL, or page-specific content)
  - Form submission test: verify a success message appears or the form state changed
  - Signing test: verify the dApp accepted the signature (dialog closed, UI updated)
- NEVER rely solely on "wallet is connected" as the only assertion for flow tests — that only proves the connection spec worked, not the flow itself
- Each test MUST have at least one assertion that verifies the specific action the recording captured actually happened

### Page Loading
- Use \`page.waitForLoadState('domcontentloaded')\` NOT \`'networkidle'\`
- Real-time trading apps have constant websocket activity that prevents networkidle
- Add \`page.waitForTimeout(3000)\` after navigation to let page stabilize

### Selector Strategy (DETERMINISTIC — follow this EXACTLY)
You MUST use selectors in this EXACT priority order. Do NOT vary the approach between runs.

**Step 1: Check the recording step's metadata fields** in this order:
1. \`dataTestId\` → use \`page.getByTestId('value')\`
2. \`ariaLabel\` → use \`page.getByLabel('value')\`
3. \`role\` + \`text\` → use \`page.getByRole('role', { name: /text/i })\`
4. \`text\` on a button → use \`page.locator('button:has-text("text")')\`
5. \`selector\` (recorded CSS) → use \`page.locator('recorded-selector')\`

**Step 2: Build the .or() chain** using ONLY the selectors that exist in the metadata.
Do NOT invent selectors that aren't in the recording data. The chain should be:
\`\`\`typescript
// Example: step has dataTestId="connect-btn", role="button", text="Connect Wallet", selector="div > button.primary"
await page.getByTestId('connect-btn')
  .or(page.getByRole('button', { name: /connect wallet/i }))
  .or(page.locator('button:has-text("Connect Wallet")'))
  .or(page.locator('div > button.primary'))  // recorded CSS — ALWAYS last
  .first()
  .click()
\`\`\`

**RULES:**
- ALWAYS add \`.first()\` after \`.or()\` chains
- ALWAYS include the recorded CSS selector as the LAST \`.or()\` fallback
- Use case-insensitive regex for role names: \`{ name: /text/i }\`
- Do NOT use \`page.getByText()\` — it matches parent containers. Use \`button:has-text()\` or \`getByRole\` instead
- For input fields: prefer \`getByTestId\` > \`getByLabel\` > \`getByRole('textbox')\` > recorded CSS
- Do NOT use \`nth-child\` or positional selectors unless the recording's CSS selector uses them

### Verifying Click Effects (Prevent False Positives)
**.or().first() chains can match the WRONG element silently.** After important clicks that should open a menu/modal/dropdown, ALWAYS verify the expected result appeared:
\`\`\`typescript
// Click profile menu icon
await page.locator('...').or(...).first().click()
await page.waitForTimeout(1000)
// VERIFY the menu actually opened before proceeding
await expect(page.locator('button:has-text("Edit")')).toBeVisible({ timeout: 5000 })
\`\`\`
If the click step is supposed to open a menu, modal, or dialog — add an \`expect().toBeVisible()\` or \`waitFor({ state: 'visible' })\` check for the NEXT step's target element BEFORE trying to click it. This catches wrong-element clicks early instead of cascading into a false positive.

### Wallet Mapping
- The recording may use Rabby, Coinbase Wallet, or other wallets
- ALWAYS map these to MetaMask in the generated test
- Look for wallet selection UI and click "MetaMask" instead of the recorded wallet

## Output Format
Generate a complete TypeScript file with:
1. Correct import: \`import { test, expect } from '../../fixtures/wallet.fixture'\`
2. Test case with \`{ wallet, page }\` destructuring
3. dappwright built-in methods for ALL MetaMask interactions
4. Strong expect() assertions that verify outcomes — a test that passes without achieving its goal is WORSE than a test that fails

## CRITICAL: No False Positives
A test that reports PASS without achieving the actual goal is a **critical bug**. To prevent this:
- After EVERY significant action (wallet connect, network switch, form submit), add an \`expect()\` that verifies the dApp UI changed as expected
- For wallet connection: verify the "Login"/"Connect" button is GONE from the dApp UI (not just window.ethereum)
- For network switch: verify by polling with \`eth_chainId\` RPC call (NOT dApp UI elements — "Switch to X" buttons are dApp-specific and unreliable, and NOT \`window.ethereum.chainId\` which is a cached property that may not update):
\`\`\`
let chainId = null
for (let i = 0; i < 10; i++) {
  chainId = await page.evaluate(async () => {
    const eth = (window as any).ethereum
    return await eth?.request?.({ method: 'eth_chainId' }) || eth?.chainId
  })
  if (chainId === '0x2105') break // 0x2105 = Base (8453)
  await page.waitForTimeout(1000)
}
expect(chainId).toBe('0x2105')
\`\`\`
- For form submissions: verify a success indicator appeared
- If a popup/modal/banner blocks an action and you can't dismiss it, the test MUST FAIL — do not silently skip the blocked action
- Wrap critical actions in try/catch ONLY if you re-throw on failure. Never swallow errors that mean the goal wasn't achieved

Do NOT include any custom MetaMask popup handling functions.
Do NOT import from '@synthetixio/synpress' or '@tenkeylabs/dappwright' directly.
Do NOT include any explanation text outside the code. Return only the TypeScript code.

## CRITICAL: Only Verify What Was Recorded
Do NOT invent verification steps for outcomes that weren't captured in the recording.
- If the recording ends at "click Create Account", the last step should be that click — NOT an assertion about the account being created.
- If the recording ends at "click Place Order", the last step should verify the order button was clicked — NOT that the trade executed.
- Only add \`expect()\` assertions for state changes that are VISIBLE in subsequent recording steps.
- The ONLY assertions you should add beyond the recording are:
  1. Wallet connection verification (always needed — dappwright starts disconnected)
  2. Network switch verification (always needed — RPC polling)
- For the final step: if the recording shows a click as the last action, verify the click target was clickable and was clicked. Do NOT speculate about what happens after.

## CRITICAL: Step Markers for Hybrid Execution
You MUST wrap each logical step in step marker comments. The test runner uses these to execute
steps independently and fall back to AI on failure.

Format:
\`\`\`
// ========================================
// STEP N: Brief description of what this step does
// ========================================
\`\`\`

Rules:
- Every page.goto() starts a new step
- Every raceApprove/raceSign call is its own step
- Every wallet.switchNetwork() is its own step
- Every wallet.confirmTransaction() is its own step
- Group related .click() + .waitForTimeout() + .fill() into the same step
- expect() verification can be its own step or grouped with the action it verifies
- Number sequentially starting from 1`;
  }

  /**
   * Build the user prompt with recording context
   */
  buildUserPrompt(): string {
    const { recording, patterns, detectedChainId, detectedWallet, walletConnected, walletAddress } = this.analysis;

    // Build context section
    let context = `## Recording Information
- Name: ${recording.name}
- Start URL: ${recording.startUrl}
- Total Steps: ${recording.steps.length}
`;

    // Test type awareness
    const testType = this.analysis.testType || 'connection';
    context += `- Test Type: ${testType}\n`;

    if (testType === 'flow') {
      context += `- This recording was made with the wallet ALREADY connected.\n`;
      context += `- The connection will be handled separately by the test runner.\n`;
      context += `- Focus ONLY on the recorded flow steps. Do NOT add wallet connection code.\n`;
      context += `- Do NOT call wallet.approve() — the wallet is already connected.\n`;
    } else if (walletConnected) {
      context += `- Wallet was connected at recording start (address: ${walletAddress || 'detected'})\n`;
      context += `- NOTE: dappwright starts with a fresh wallet — you MUST add wallet connection steps at the beginning\n`;
      context += `- The recording may NOT include connection steps since it was already connected\n`;
    } else {
      context += `- Wallet Connected at Start: No\n`;
      context += `- The recording INCLUDES wallet connection steps - generate code for them\n`;
    }

    if (detectedChainId) {
      const network = this.networkConfigs.get(detectedChainId);
      context += `- Detected Chain during recording: ${network?.name || 'Unknown'} (Chain ID: ${detectedChainId}) — NOTE: test wallet starts on Mainnet, do NOT assert this chain ID\n`;
    }

    if (detectedWallet) {
      context += `- Recorded Wallet: ${detectedWallet} (will be mapped to MetaMask)\n`;
    }

    // Add dApp connection pattern info
    if (this.analysis.dappConnectionPattern && this.analysis.dappConnectionPattern !== 'unknown') {
      context += `- dApp Connection Pattern: ${this.analysis.dappConnectionPattern}\n`;
    }

    // Add per-project dApp context if provided
    if (this._options.dappContext) {
      context += `\n## dApp Context (Project-Specific)\n${this._options.dappContext}\n`;
    }

    // Add detected patterns
    context += `\n## Detected Flow Patterns\n`;
    for (const pattern of patterns) {
      context += `- ${pattern.type} (steps ${pattern.startIndex}-${pattern.endIndex}, confidence: ${(pattern.confidence * 100).toFixed(0)}%)\n`;
    }

    // Add relevant example if available
    let exampleSection = '';
    const relevantExample = this.findRelevantExample();
    if (relevantExample) {
      exampleSection = `\n## Similar Example\nHere's a working spec for a similar flow:\n\n\`\`\`typescript\n${relevantExample.spec}\n\`\`\`\n`;
    }

    // Add dApp pattern guidance if we detected a known pattern
    if (this.dappPatterns && this.analysis.dappConnectionPattern !== 'unknown') {
      const patternData = this.dappPatterns as { patterns?: Array<{ name: string; connectionFlow?: string[]; obstacles?: string[] }> };
      const matchingPattern = patternData.patterns?.find(
        (p) => p.name.toLowerCase().includes(this.analysis.dappConnectionPattern)
      );
      if (matchingPattern) {
        context += `\n## Known dApp Pattern: ${matchingPattern.name}\n`;
        if (matchingPattern.connectionFlow) {
          context += `Connection flow:\n${matchingPattern.connectionFlow.map((s) => `- ${s}`).join('\n')}\n`;
        }
        if (matchingPattern.obstacles) {
          context += `Known obstacles:\n${matchingPattern.obstacles.map((s) => `- ${s}`).join('\n')}\n`;
        }
      }
    }

    // Add SIWE guidance for Privy dApps (ALWAYS needed, even if recording lacks personal_sign)
    if (this.analysis.dappConnectionPattern === 'privy') {
      context += `\n## CRITICAL: Privy dApps ALWAYS Require SIWE
Privy-based dApps ALWAYS require SIWE (Sign-In With Ethereum) after wallet connection.
The recording may NOT contain the \`personal_sign\` step because the user's existing wallet
auto-handled it, but a fresh MetaMask wallet WILL be prompted.

**GOOD NEWS**: \`raceApprove(wallet, page.context(), page)\` handles SIWE automatically.
Just call \`raceApprove\` and it will:
1. Approve the connection (race-safe — detects already-open popups)
2. Auto-detect and sign the SIWE popup

\`\`\`typescript
// Click MetaMask in Privy modal
await page.getByRole('button', { name: /metamask/i }).click()

// Race-safe approve + auto SIWE — ONE call does everything
await raceApprove(wallet, page.context(), page)

// Verify connection
const connected = await page.evaluate(() => {
  const eth = (window as any).ethereum
  return eth?.selectedAddress || eth?.accounts?.[0] || null
})
expect(connected?.toLowerCase()).toContain('0x')
\`\`\`

Do NOT use bare \`wallet.approve()\` — it WILL miss already-open popups.
Do NOT write manual popup detection code — \`raceApprove\` handles it all.\n`;
    }

    // Add console log context if available (filtered for errors/warnings)
    const consoleLogs = (recording as unknown as { consoleLogs?: Array<{ level: string; args: string[]; timestamp: number }> }).consoleLogs;
    if (consoleLogs && consoleLogs.length > 0) {
      const errorLogs = consoleLogs
        .filter((l) => l.level === 'error' || l.level === 'warn')
        .slice(-20); // Last 20 error/warning entries
      if (errorLogs.length > 0) {
        context += `\n## Console Errors/Warnings During Recording\n`;
        for (const log of errorLogs) {
          context += `- [${log.level}] ${log.args.join(' ').slice(0, 200)}\n`;
        }
      }
    }

    // Format the recording steps — deduplicate noisy web3 polling calls
    const seenWeb3Methods = new Set<string>();
    const filteredSteps = recording.steps.filter((step) => {
      if (step.type === 'web3') {
        const method = step.web3Method || '';
        // Keep first occurrence of actionable methods, deduplicate polling calls
        const pollingMethods = ['eth_chainId', 'eth_accounts', 'eth_blockNumber', 'eth_getBalance', 'eth_call', 'net_version'];
        if (pollingMethods.includes(method)) {
          if (seenWeb3Methods.has(method)) {
            return false; // Skip duplicate polling calls
          }
          seenWeb3Methods.add(method);
        }
      }
      return true;
    });

    const stepsJson = JSON.stringify(
      filteredSteps.map((step) => {
        const cleaned = { ...step };
        // Remove large base64 screenshots to save tokens (can be 170KB+ each)
        if ('screenshot' in cleaned) {
          delete (cleaned as Record<string, unknown>).screenshot;
        }
        // Remove large base64 icons to save tokens
        if (cleaned.type === 'web3' && cleaned.web3ProviderInfo?.icon) {
          cleaned.web3ProviderInfo = {
            ...cleaned.web3ProviderInfo,
            icon: '[removed]',
          };
        }
        return cleaned;
      }),
      null,
      2
    );

    // Build goal verification instructions based on detected patterns
    let goalVerification = '';
    const patternTypes = new Set(patterns.map((p) => p.type));
    if (patternTypes.has('wallet_connect')) {
      goalVerification += `\n## Goal Verification: Wallet Connection
After the connection flow, you MUST verify BOTH the provider AND the dApp UI:
\`\`\`typescript
// 1. Verify MetaMask provider reports connected
const connected = await page.evaluate(() => {
  const eth = (window as any).ethereum
  return eth?.selectedAddress || eth?.accounts?.[0] || null
})
expect(connected?.toLowerCase()).toContain('0x')

// 2. Verify the dApp UI reflects the connection
// The button you clicked to START the connection flow (e.g., "Login", "Connect Wallet", "Sign In")
// should no longer be visible. Look at the recording's first click — that button should be GONE now.
// Replace the selector below with the actual button from the recording:
// await expect(page.locator('<the connect/login button selector>')).not.toBeVisible({ timeout: 10000 })
\`\`\`
**CRITICAL**: A passing ethereum provider check alone is NOT sufficient — the dApp UI must also reflect
the connection. If the connect/login button is still visible, the wallet session was likely lost.
Look at the FIRST button clicked in the recording's wallet_connect pattern and verify it disappeared.\n`;
    }
    if (patternTypes.has('network_switch')) {
      goalVerification += `\n## Goal Verification: Network Switch
After switching networks, verify by polling with \`eth_chainId\` RPC call.
Do NOT use \`window.ethereum.chainId\` (cached property, may be stale).
Do NOT check dApp-specific UI elements like "Switch to X" buttons — these are unreliable.
\`\`\`typescript
// Poll with active RPC call — bypasses cached chainId property
let chainId = null
for (let i = 0; i < 10; i++) {
  chainId = await page.evaluate(async () => {
    const eth = (window as any).ethereum
    return await eth?.request?.({ method: 'eth_chainId' }) || eth?.chainId
  })
  if (chainId === '0x2105') break // Use the correct hex chain ID for the target network
  await page.waitForTimeout(1000)
}
expect(chainId).toBe('0x2105') // 0x2105 = Base (8453)
\`\`\`
**CRITICAL**: Do NOT call page.reload() after wallet.switchNetwork() — this disconnects the wallet session.
**CRITICAL**: Do NOT verify network switch by checking dApp UI buttons (e.g., "Switch to Base"). These are dApp-specific and may remain visible due to rendering delays or hidden overlay elements.\n`;
    }
    if (patternTypes.has('wallet_sign')) {
      goalVerification += `\n## Goal Verification: Signature / SIWE
After signing, wait for the dApp to process the signature:
\`\`\`typescript
// Verify the sign-in dialog/modal has closed (SIWE completed)
await page.waitForTimeout(5000)
// Verify wallet is still connected
const connected = await page.evaluate(() => {
  const eth = (window as any).ethereum
  return eth?.selectedAddress || eth?.accounts?.[0] || null
})
expect(connected?.toLowerCase()).toContain('0x')
\`\`\`\n`;
    }

    // For flow tests: add strong verification that the actual flow steps happened
    if (this.analysis.testType === 'flow') {
      goalVerification += `\n## CRITICAL: Flow Test Goal Verification
This is a FLOW test — the wallet is already connected. You MUST add assertions that verify the ACTUAL USER ACTIONS were performed, not just that the wallet is connected.

**Guidelines for flow test assertions:**
- After clicking a menu/button to open something: verify the opened panel/modal/dropdown is visible before proceeding (use \`waitFor({ state: 'visible' })\`)
- After filling an input: verify the input contains the expected value using \`expect(locator).toHaveValue('...')\`
- After submitting a form: verify a success indicator appeared (toast, success message, form closed)
- After navigating to a page: verify the page-specific content is visible (heading, URL path)
- After a wallet.sign(): verify the dApp's UI updated to show the signature was accepted (dialog closed, state changed)
- **NEVER** use "wallet is connected" as the only assertion — that doesn't verify the flow

**Critical: Each interaction step should have a visible effect.** If clicking a button doesn't change anything visible, the click probably hit the wrong element. Add \`expect()\` or \`waitFor()\` checks after important interactions to catch this early instead of letting the test silently pass as a false positive.

Example for a username change test:
\`\`\`typescript
// After filling username and clicking Save:
await wallet.sign() // if signing needed
await page.waitForTimeout(3000)
// Verify the username was actually updated
await expect(page.locator('text=Sidharth')).toBeVisible({ timeout: 10000 })
// OR verify a success toast/message appeared
// OR verify the edit dialog closed
\`\`\`\n`;
    }

    return `${context}
${exampleSection}
## Recording Steps (JSON)
\`\`\`json
${stepsJson}
\`\`\`

## Generation Requirements
- Target wallet: MetaMask
- Use dappwright built-in methods: raceApprove(), raceSign(), wallet.confirmTransaction()
- Import: \`import { test, expect, raceApprove, raceSign } from '../../fixtures/wallet.fixture'\`
- Generate robust selectors with fallbacks using .or() chains with .first()
- Prefer: data-testid > getByRole > button:has-text() > original recorded CSS selector
- **CRITICAL: Each step has a \`selector\` field — ALWAYS include it as the LAST .or() fallback**
- Do NOT use page.getByText() for clicking — use page.locator('button:has-text(...)') or page.getByRole('button') instead
- **CRITICAL: Do NOT invent verification steps beyond what the recording captured** — if the recording ends at a button click, end the test there
- Add appropriate waits after wallet interactions
- Handle conditional UI states (modals that may or may not appear)
- Use expect() assertions to verify wallet connection and signing succeeded
- If the recording shows Rabby/Coinbase/other wallet, click "MetaMask" instead in the wallet selection modal
- Handle common obstacles: cookie banners, terms acceptance, welcome modals (dismiss them)
${goalVerification}
Generate a complete, working Playwright/dappwright test spec for this recording.`;
  }

  /**
   * Find the most relevant example from the knowledge base
   */
  private findRelevantExample(): { recording: Recording; spec: string } | null {
    if (this.examples.size === 0) {
      return null;
    }

    // For now, return the first example
    // In a more advanced implementation, we'd match based on:
    // - Same dApp URL pattern
    // - Similar flow patterns
    // - Same chain ID
    const firstExample = this.examples.values().next().value;
    return firstExample || null;
  }

  /**
   * Get network configuration for a chain ID
   */
  getNetworkConfig(chainId: number): NetworkConfig | undefined {
    return this.networkConfigs.get(chainId);
  }

  /**
   * Build a retry prompt for self-healing regeneration
   */
  buildRetryPrompt(failureContext: FailureContext): string {
    const { previousCode, error, logs, diagnosis, category, attempt, maxAttempts } = failureContext;

    // Truncate logs to last 3000 chars
    const truncatedLogs = logs.length > 3000 ? '...' + logs.slice(-3000) : logs;

    let categoryGuidance = '';
    switch (category) {
      case 'selector':
        categoryGuidance = `## Selector Fix Strategy
The previous spec used selectors that didn't match the actual DOM.
- Try alternative selectors: data-testid, getByRole, getByText, CSS with .or().first()
- Look at the screenshots to identify the actual UI elements
- Use more general text matching (partial, case-insensitive)
- If a modal/dialog appeared unexpectedly, handle it before the failing step`;
        break;
      case 'timeout':
        categoryGuidance = `## Timeout Fix Strategy
Elements were not appearing in time.
- Increase waitForTimeout values (try 5000ms instead of 3000ms)
- Add explicit waitForSelector before interacting
- Check if a loading spinner/overlay needs to be waited out
- The dApp may load slowly — add page.waitForLoadState('domcontentloaded')`;
        break;
      case 'wallet':
        categoryGuidance = `## Wallet Interaction Fix Strategy
MetaMask/dappwright interaction failed.
- ALWAYS use raceApprove(wallet, page.context(), page) instead of wallet.approve()
- raceApprove handles already-open popups + auto SIWE — no manual popup code needed
- Use wallet.switchNetwork() directly instead of clicking network switch buttons
- Check if the dApp needs a specific wallet selection step (click "MetaMask" in modal)`;
        break;
      case 'assertion':
        categoryGuidance = `## Assertion Fix Strategy
The test assertion failed.
- The wallet may have connected but the check was wrong
- Use page.evaluate(() => window.ethereum.selectedAddress) for connection check
- Don't assert specific addresses or chain IDs
- Add longer waits before assertions (dApp state may update asynchronously)`;
        break;
      case 'network':
        categoryGuidance = `## Network Fix Strategy
Navigation or network error occurred.
- The dApp URL may have changed or redirected
- Add page.waitForLoadState('domcontentloaded') after navigation
- Don't use 'networkidle' — real-time dApps have constant WebSocket activity
- Check if the dApp requires accepting terms/cookies first`;
        break;
      default:
        categoryGuidance = `## General Fix Strategy
- Review the error message carefully
- Check screenshots for the actual UI state
- Simplify the test if possible
- Ensure proper wait times between steps`;
    }

    // Include original recording steps so Claude can see the exact selectors that worked
    const recordingSteps = this.analysis.recording.steps
      .filter((s) => s.type === 'click' || s.type === 'input')
      .map((s, i) => {
        const meta = (s as unknown as { metadata?: { text?: string } }).metadata;
        return `  Step ${i + 1}: type=${s.type}, selector="${(s as unknown as { selector?: string }).selector || ''}", text="${meta?.text || ''}"`;
      })
      .join('\n');

    return `## Self-Healing Attempt ${attempt}/${maxAttempts}

The previous test spec FAILED. Your job is to fix it based on the error information below.

${categoryGuidance}

## Original Recording Selectors (these WORKED when user recorded)
These are the exact CSS selectors captured during recording. Use them as fallbacks:
${recordingSteps}

**CRITICAL: Always include the original recorded selector as the LAST .or() fallback.**
Do NOT use page.getByText() for clicking — it matches parent containers. Use page.locator('button:has-text(...)') or getByRole instead.

## Previous Failed Spec
\`\`\`typescript
${previousCode}
\`\`\`

## Error Message
\`\`\`
${error}
\`\`\`

## AI Diagnosis
${diagnosis}

## Test Output (last 3000 chars)
\`\`\`
${truncatedLogs}
\`\`\`

## Screenshots
${failureContext.screenshots.length > 0
  ? `${failureContext.screenshots.length} screenshot(s) are attached showing the dApp state at failure time. Study them carefully to understand what the UI actually looks like.`
  : 'No screenshots available.'}

## Test Type
${this.analysis.testType === 'flow'
  ? `**This is a FLOW test.** The wallet connection is handled by a SEPARATE connection test that runs first.
Do NOT add wallet connection steps (no Login button clicks, no wallet.approve() for connection, no "Continue with a wallet" clicks).
The wallet WILL already be connected when this test runs. Focus ONLY on the post-connection flow steps.
If the error is about wallet not being connected, that means the connection test (which runs first) failed — do NOT try to fix it by adding connection steps here.`
  : `This is a CONNECTION test. It must handle the full wallet connection flow.`}

## Requirements
- Fix the specific issue identified above
- Keep the same test structure and goals
- Use the same import: \`import { test, expect } from '../../fixtures/wallet.fixture'\`
- ALWAYS include the original recorded CSS selector as the LAST .or() fallback for each click step
- Do NOT use page.getByText() — use page.locator('button:has-text(...)') or page.getByRole('button') instead
- Return ONLY the complete fixed TypeScript spec, no explanation text`;
  }

  /**
   * Build a focused prompt for a specific section of the recording
   */
  buildSectionPrompt(startIndex: number, endIndex: number): string {
    const sectionSteps = this.analysis.recording.steps.slice(startIndex, endIndex + 1);

    return `Generate Playwright code for these steps (${startIndex}-${endIndex}):

\`\`\`json
${JSON.stringify(sectionSteps, null, 2)}
\`\`\`

Return only the code for these steps, not a complete test file.`;
  }
}

/**
 * Create a prompt builder for the given analysis
 */
export function createPromptBuilder(
  analysis: AnalysisResult,
  options?: Partial<GenerationOptions>
): PromptBuilder {
  const defaultOptions: GenerationOptions = {
    targetWallet: 'metamask',
    testFramework: 'dappwright',
    includeComments: true,
    includeScreenshots: false,
    selectorStrategy: 'auto',
  };

  return new PromptBuilder(analysis, { ...defaultOptions, ...options });
}
