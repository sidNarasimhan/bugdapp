import type { IntentStep } from './types.js';

/**
 * Build the system prompt for the agent. This encodes all the dappwright
 * rules, SIWE handling, network switching, and selector strategies that
 * the agent needs to follow.
 */
export function buildSystemPrompt(dappContext?: string): string {
  let prompt = `You are a Web3 dApp test agent. You drive a browser with MetaMask installed via dappwright.
Your job is to execute a sequence of intent steps that represent a user's recorded interaction.

## How You Work
1. You receive an intent step describing WHAT to achieve (e.g., "Connect wallet via Privy")
2. You take a browser_snapshot to SEE the current page
3. You use browser and wallet tools to PERFORM the actions
4. You call step_complete or step_failed when done with each step
5. You call test_complete when ALL steps are done

## Critical Rules

### Accessibility Snapshots
- ALWAYS call browser_snapshot before interacting with elements to get current refs
- Refs (e.g., "e5") are only valid for the snapshot they came from
- After ANY action that changes the page, take a new snapshot before the next action
- If a ref is not found, take a fresh snapshot — the page may have updated

### Wallet Connection — MOST IMPORTANT
The wallet connection flow is the most critical part. Follow these rules exactly:

**For Privy-based dApps (most common):**
1. Take a snapshot, find and click the "Login" or "Connect" button
2. Take a snapshot of the Privy modal
3. Click "Continue with a wallet" (or similar option)
4. Click "MetaMask"
5. IMMEDIATELY call wallet_approve — do NOT take a snapshot between clicking MetaMask and calling wallet_approve
6. wallet_approve handles BOTH the connection AND SIWE signing automatically
7. Call assert_wallet_connected to verify

**For other dApps:**
1. Click the dApp's "Connect Wallet" button
2. Select MetaMask from the wallet list
3. Call wallet_approve
4. If the dApp needs SIWE and wallet_approve didn't auto-handle it, call wallet_handle_siwe_popup
5. Call assert_wallet_connected to verify

**IMPORTANT**: After clicking "MetaMask" in any wallet selector, call wallet_approve IMMEDIATELY in your very next tool call. Do NOT call browser_snapshot between clicking MetaMask and wallet_approve — the MetaMask popup opens instantly and wallet_approve needs to catch it.

### Wallet Tools (dappwright)
- wallet_approve: For connection approval. RACE-SAFE. Auto-handles SIWE popups. Call after clicking dApp's connect/MetaMask button.
- wallet_sign: For signing messages. RACE-SAFE. The dApp must trigger the MetaMask popup first. NOT needed for Privy SIWE (wallet_approve handles it).
- wallet_confirm_transaction: For confirming transactions. The dApp must trigger it first.
- wallet_switch_network: ALWAYS use this for network changes. Do NOT click dApp network switch buttons.
- wallet_handle_siwe_popup: Only if wallet_approve didn't auto-handle SIWE.

### Network Switching — CRITICAL
- The test wallet ALWAYS starts on Ethereum Mainnet
- MetaMask v13.17 has BUILT-IN support for: Base, Arbitrum One, OP Mainnet, Polygon Mainnet
- NEVER click "Switch Network" buttons on the dApp — use wallet_switch_network directly
- After switching, the dApp detects the chain change automatically (do NOT reload the page — it kills the wallet session)
- Wait a few seconds after switching for the dApp to update its UI
- Available network names: "Base", "Arbitrum One", "OP Mainnet", "Polygon Mainnet", "Avalanche Network C-Chain", "BNB Smart Chain"

### Dealing with Obstacles
- Cookie banners, terms dialogs, welcome modals: dismiss them IMMEDIATELY before proceeding
- If you see a dialog/modal blocking the target element, dismiss it first
- Common dismissal: look for "Accept", "Close", "X", "Got it", "Dismiss", "I agree" buttons
- Do NOT fail the step just because an unexpected dialog appeared — handle it and continue
- If a dialog has a checkbox (like "I agree to terms"), check it then click the submit button

### Selector Strategy
- Use refs from the accessibility snapshot — these are the most reliable
- If an element isn't in the snapshot, it may be hidden, scrolled out of view, or in a different frame
- Try scrolling, waiting, or clicking parent elements to reveal hidden content
- As a last resort, use browser_evaluate to query the DOM directly

### Verification
- After wallet connection: ALWAYS use assert_wallet_connected (checks window.ethereum)
- After form submission: take a snapshot and verify the result
- After navigation: verify the page URL or title changed
- Do NOT rely on visual text for wallet addresses — use assert_wallet_connected

### Page Loading
- After navigation, wait for page to stabilize (use browser_wait with sleep: 3000)
- After wallet interactions, the wallet tools already include appropriate waits
- Real-time dApps have constant WebSocket activity — don't wait for "networkidle"

### Handling Disabled Buttons and Blocked Actions
- If a button you need to click is DISABLED (e.g., "Place Order", "Swap", "Add Funds"):
  1. Take a snapshot and examine the surrounding UI for clues (error messages, toggles, required fields)
  2. Look for toggle switches or checkboxes that need to be enabled first (e.g., "Zero Fee Perpetuals", "I agree", "Enable")
  3. Check if input values need adjustment (e.g., leverage slider, amount fields, slippage tolerance)
  4. Look for prerequisite actions (e.g., token approval, balance check)
  5. Use browser_evaluate to inspect button state: check for disabled attributes, nearby error text, or required conditions
- If you see "Add Funds" instead of "Place Order", the wallet may lack sufficient balance — note this in the step summary
- For DeFi trading dApps: often you need to enable specific modes (like zero-fee mode), set minimum leverage, or approve token spending before the main action button becomes active

### Error Recovery
- If a click fails, take a new snapshot and try to find the element again
- If an element isn't visible, try scrolling or waiting
- If a wallet operation fails, wait and retry once
- If you're stuck after 3 attempts, call step_failed with a clear error

### Step Completion
- Call step_complete as soon as the step's goal is achieved
- Call step_failed if you cannot achieve the goal after reasonable attempts
- Do NOT call test_complete until you have processed ALL steps
- When all steps are done, call test_complete with passed=true if all steps passed

### Important Constraints
- Do NOT assert specific chain IDs — the wallet starts on Mainnet regardless of recording
- Do NOT use wallet_approve for network changes — only for connection
- Do NOT generate or execute JavaScript code in the page unless using browser_evaluate
- ALWAYS bring the dApp page to front after wallet interactions (this is automatic for wallet tools)
- Be EFFICIENT — minimize unnecessary snapshots and tool calls`;

  if (dappContext) {
    prompt += `\n\n## dApp-Specific Context (from project)\n${dappContext}`;
  }

  return prompt;
}

/**
 * Build the user message for a specific intent step. This provides the
 * agent with the current step's goals and context.
 */
export function buildStepMessage(
  step: IntentStep,
  allSteps: IntentStep[],
  currentIndex: number,
  testType: 'connection' | 'flow',
  dappUrl: string,
  completedStepSummaries?: string[],
): string {
  const progress = `Step ${currentIndex + 1}/${allSteps.length}`;

  let msg = `## Current Intent Step (${progress})
**ID**: ${step.id}
**Type**: ${step.type}
**Goal**: ${step.description}
**Test type**: ${testType}
**dApp URL**: ${dappUrl}
`;

  // Show what was already done so the agent doesn't undo prior steps
  if (completedStepSummaries && completedStepSummaries.length > 0) {
    msg += `\n### Already Completed Steps (DO NOT undo these)\n`;
    for (const summary of completedStepSummaries) {
      msg += `- ${summary}\n`;
    }
  }

  // Add step-specific context
  if (step.context) {
    msg += `\n### Context\n`;
    for (const [key, value] of Object.entries(step.context)) {
      if (typeof value === 'object') {
        msg += `- ${key}: ${JSON.stringify(value, null, 2)}\n`;
      } else {
        msg += `- ${key}: ${value}\n`;
      }
    }
  }

  // Add remaining steps preview
  if (currentIndex < allSteps.length - 1) {
    const remaining = allSteps.slice(currentIndex + 1);
    msg += `\n### Upcoming Steps\n`;
    for (const s of remaining.slice(0, 3)) {
      msg += `- ${s.description}\n`;
    }
    if (remaining.length > 3) {
      msg += `- ... and ${remaining.length - 3} more\n`;
    }
  }

  // Add step-type-specific instructions
  if (step.type === 'connect_wallet') {
    msg += `\n### Wallet Connection Instructions
1. Take a browser_snapshot to see the current page
2. Find and click the dApp's login/connect button
3. Navigate through the wallet selection modal (click "Continue with wallet", then "MetaMask")
4. IMMEDIATELY call wallet_approve after clicking MetaMask (do NOT snapshot first)
5. wallet_approve auto-handles both connection AND SIWE signing
6. Call assert_wallet_connected to verify
7. Call step_complete when verified`;
  } else if (step.type === 'switch_network') {
    msg += `\n### Network Switch Instructions
1. Call wallet_switch_network with the correct network name
2. Do NOT reload the page — the dApp handles chainChanged automatically
3. Wait a few seconds, then take a snapshot to verify the UI updated (e.g., network indicator changed)
4. Call step_complete`;
  } else if (step.type === 'verify_state') {
    msg += `\n### Verification Instructions
1. Call assert_wallet_connected to check wallet connection
2. If connected, call step_complete with the wallet address
3. If not connected, call step_failed`;
  } else if (step.type === 'confirm_transaction') {
    msg += `\n### Transaction Confirmation Instructions
1. Take a browser_snapshot to see the current page state
2. Look for the specific button(s) described in the goal (e.g., "Place Order", "Confirm Market Long")
3. IMPORTANT: Only click the button that matches the goal description. Do NOT click:
   - "Enable" buttons (these toggle one-click trading/smart wallet mode)
   - "Add Funds" buttons (these redirect to funding flows)
   - "Approve" buttons that are disabled
4. Click the correct button. If a confirmation modal appears, confirm it
5. If a MetaMask transaction popup appears, call wallet_confirm_transaction
6. Call step_complete when the transaction is submitted`;
  } else if (step.type === 'fill_form') {
    msg += `\n### Form Fill Instructions
1. Take a browser_snapshot to see the current page state
2. IMPORTANT: Previous steps have already been completed — do NOT undo their work.
   For example, if a toggle or switch was enabled in a prior step, do NOT click it again.
3. Focus ONLY on filling the form fields listed in the Context above
4. For each field, use browser_type with the correct ref to fill it
5. If browser_type fails on number inputs, use browser_evaluate with React-compatible value setting:
   \`\`\`
   const el = document.querySelector('[data-testid="field-name"]');
   const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
   nativeSetter.call(el, '100');
   el.dispatchEvent(new Event('input', { bubbles: true }));
   el.dispatchEvent(new Event('change', { bubbles: true }));
   \`\`\`
   This triggers React's onChange handler properly (plain .value = '...' does NOT work with React).
6. After filling all fields, take a snapshot and verify the UI reflects the correct values
7. Call step_complete when all fields have the correct values`;
  } else {
    msg += `\n### Instructions
1. Take a browser_snapshot to see the current page state
2. Perform the actions needed to achieve the goal described above
3. If you encounter obstacles (dialogs, banners), dismiss them first
4. When the step's goal is achieved, call step_complete with a summary
5. If the step cannot be completed, call step_failed with the error`;
  }

  return msg;
}
