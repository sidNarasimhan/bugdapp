import type { IntentStep, IntentStepType } from './types.js';

// Use the same types from translator, but referenced loosely to avoid hard dependency
interface RecordingStep {
  id: string;
  type: string;
  timestamp: number;
  selector?: string;
  value?: string;
  url?: string;
  web3Method?: string;
  web3Params?: any;
  metadata?: {
    text?: string;
    dataTestId?: string;
    tagName?: string;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Recording {
  name: string;
  startUrl: string;
  steps: RecordingStep[];
  walletConnected?: boolean;
  [key: string]: unknown;
}

interface FlowPattern {
  type: string;
  startIndex: number;
  endIndex: number;
  steps: RecordingStep[];
  confidence: number;
  metadata?: Record<string, unknown>;
}

interface AnalysisResult {
  recording: Recording;
  patterns: FlowPattern[];
  detectedChainId?: number;
  testType: 'connection' | 'flow';
  dappConnectionPattern: string;
  [key: string]: unknown;
}

// Network name mapping for chain IDs
const CHAIN_ID_TO_NETWORK: Record<number, string> = {
  1: 'Ethereum Mainnet',
  8453: 'Base',
  42161: 'Arbitrum One',
  10: 'OP Mainnet',
  137: 'Polygon Mainnet',
  43114: 'Avalanche Network C-Chain',
  56: 'BNB Smart Chain',
};

/**
 * Convert a recording analysis into semantic IntentSteps.
 * Collapses raw recording events into high-level goals.
 */
export function buildIntentSteps(
  analysis: AnalysisResult,
): IntentStep[] {
  const { recording, patterns, testType, dappConnectionPattern } = analysis;
  const steps: IntentStep[] = [];
  let stepId = 0;

  function nextId(): string {
    return `step-${++stepId}`;
  }

  // Track which recording indices have been consumed by patterns
  const consumed = new Set<number>();

  // 1. Navigation to start URL (always first for connection tests)
  if (testType === 'connection' && recording.startUrl) {
    steps.push({
      id: nextId(),
      description: `Navigate to ${recording.startUrl}`,
      type: 'navigate',
      sourceStepIndices: [],
      context: { url: recording.startUrl },
    });
  } else if (testType === 'flow' && recording.startUrl) {
    // For flow tests, the page should already be at the URL from connection
    // but verify/navigate if needed
    steps.push({
      id: nextId(),
      description: `Ensure page is at ${recording.startUrl}`,
      type: 'navigate',
      sourceStepIndices: [],
      context: { url: recording.startUrl },
    });
  }

  // 2. Build a map of pattern steps (by their startIndex for ordering)
  //    and remaining unconsumed steps, then merge them in RECORDING ORDER.
  //    This ensures e.g. a click that precedes a form fill stays before it.

  // First pass: mark consumed indices and build pattern intent steps
  interface OrderedIntentStep extends IntentStep {
    _orderIndex: number; // earliest recording index for sorting
  }
  const orderedSteps: OrderedIntentStep[] = [];

  for (const pattern of patterns) {
    const indices = Array.from(
      { length: pattern.endIndex - pattern.startIndex + 1 },
      (_, i) => pattern.startIndex + i
    );
    indices.forEach((i) => consumed.add(i));

    let intentStep: IntentStep | undefined;

    switch (pattern.type) {
      case 'wallet_connect': {
        if (testType === 'flow') break; // Skip connection in flow tests

        const connectionDesc = dappConnectionPattern !== 'unknown'
          ? `Connect wallet via ${dappConnectionPattern}`
          : 'Connect wallet';

        intentStep = {
          id: nextId(),
          description: connectionDesc,
          type: 'connect_wallet',
          sourceStepIndices: indices,
          context: {
            dappConnectionPattern,
            clickHints: pattern.steps
              .filter((s) => s.type === 'click')
              .map((s) => ({
                selector: s.selector,
                text: s.metadata?.text,
                testId: s.metadata?.dataTestId,
              })),
          },
        };
        break;
      }

      case 'wallet_sign': {
        intentStep = {
          id: nextId(),
          description: 'Sign message in MetaMask',
          type: 'sign_message',
          sourceStepIndices: indices,
          context: {
            isSiwe: dappConnectionPattern === 'privy' || patterns.some(
              (p) => p.type === 'wallet_connect' && p.endIndex < pattern.startIndex
            ),
          },
        };
        break;
      }

      case 'network_switch': {
        const chainId = pattern.metadata?.chainId as number | undefined;
        const networkName = chainId ? CHAIN_ID_TO_NETWORK[chainId] : undefined;

        intentStep = {
          id: nextId(),
          description: `Switch network to ${networkName || `chain ${chainId}`}`,
          type: 'switch_network',
          sourceStepIndices: indices,
          context: { chainId, networkName },
        };
        break;
      }

      case 'trade_open':
      case 'trade_close':
      case 'wallet_approve': {
        const clickSteps = pattern.steps.filter((s) => s.type === 'click');
        const desc = clickSteps.map((s) => s.metadata?.text).filter(Boolean).join(' → ');

        intentStep = {
          id: nextId(),
          description: `${pattern.type === 'wallet_approve' ? 'Approve token' : 'Execute trade'}: ${desc || pattern.type}`,
          type: 'confirm_transaction',
          sourceStepIndices: indices,
          context: {
            clickHints: clickSteps.map((s) => ({
              selector: s.selector,
              text: s.metadata?.text,
              testId: s.metadata?.dataTestId,
            })),
          },
        };
        break;
      }

      case 'form_fill': {
        const inputSteps = pattern.steps.filter((s) => s.type === 'input');

        // Deduplicate by selector — keep only the LAST value per field.
        // Recordings capture every keystroke (e.g. collateral typed twice, leverage
        // typed as 7 then 100), so we only want the final value.
        const fieldMap = new Map<string, { selector?: string; value?: string; placeholder?: string; testId?: string }>();
        for (const s of inputSteps) {
          const key = s.selector || s.metadata?.dataTestId || s.metadata?.placeholder || `field-${fieldMap.size}`;
          // Extract testId from selector if not in metadata (e.g. [data-testid="collateral-input"] → collateral-input)
          const testIdFromSelector = s.selector?.match(/data-testid="([^"]+)"/)?.[1];
          fieldMap.set(key, {
            selector: s.selector,
            value: s.value,
            placeholder: s.metadata?.placeholder,
            testId: s.metadata?.dataTestId || testIdFromSelector,
          });
        }
        const fields = Array.from(fieldMap.values());

        // Build human-readable description using testId or placeholder names
        const fieldDescs = fields.map((f) => {
          const name = f.testId?.replace(/-/g, ' ') || f.placeholder || 'field';
          return `${name}=${f.value}`;
        });

        intentStep = {
          id: nextId(),
          description: `Fill form: ${fieldDescs.join(', ')}`,
          type: 'fill_form',
          sourceStepIndices: indices,
          context: { fields },
        };
        break;
      }

      case 'navigation': {
        const url = pattern.metadata?.url as string | undefined;
        if (url) {
          intentStep = {
            id: nextId(),
            description: `Navigate to ${url}`,
            type: 'navigate',
            sourceStepIndices: indices,
            context: { url },
          };
        }
        break;
      }
    }

    if (intentStep) {
      orderedSteps.push({ ...intentStep, _orderIndex: pattern.startIndex });
    }
  }

  // 3. Process remaining unconsumed steps (clicks, inputs not part of patterns)
  const hasNetworkSwitch = orderedSteps.some((s) => s.type === 'switch_network') || steps.some((s) => s.type === 'switch_network');
  const hasWalletConnect = orderedSteps.some((s) => s.type === 'connect_wallet') || steps.some((s) => s.type === 'connect_wallet');
  const networkNames = Object.values(CHAIN_ID_TO_NETWORK);

  for (let i = 0; i < recording.steps.length; i++) {
    if (consumed.has(i)) continue;
    const step = recording.steps[i];

    // Skip noise
    if (step.type === 'web3') {
      const noisy = ['eth_chainId', 'eth_accounts', 'eth_blockNumber', 'eth_getBalance', 'eth_call', 'net_version'];
      if (noisy.includes(step.web3Method || '')) continue;
    }
    if (step.type === 'scroll') continue;

    if (step.type === 'click') {
      const text = step.metadata?.text || step.metadata?.ariaLabel || '';

      // Skip clicks that are redundant with already-created switch_network steps
      if (hasNetworkSwitch && text) {
        const isNetworkClick = /switch\s*(to\s*)?(network|base|arbitrum|polygon|optimism|mainnet|bnb|avalanche)/i.test(text)
          || networkNames.some((n) => text.toLowerCase().includes(n.toLowerCase()));
        if (isNetworkClick) continue;
      }

      // Skip clicks that are part of wallet connection flow (handled by wallet tools)
      if (hasWalletConnect && text) {
        const isWalletClick = /^(connect|login|sign\s*in|metamask|continue\s*with|wallet)/i.test(text);
        if (isWalletClick) continue;
      }

      const desc = text ? `Click "${text}"` : `Click element`;

      orderedSteps.push({
        id: nextId(),
        description: desc,
        type: 'click_element',
        sourceStepIndices: [i],
        context: {
          selector: step.selector,
          text: step.metadata?.text,
          testId: step.metadata?.dataTestId,
          tagName: step.metadata?.tagName,
        },
        _orderIndex: i,
      });
    } else if (step.type === 'input') {
      orderedSteps.push({
        id: nextId(),
        description: `Type "${step.value}" into ${step.metadata?.placeholder || 'input'}`,
        type: 'fill_form',
        sourceStepIndices: [i],
        context: {
          fields: [{
            selector: step.selector,
            value: step.value,
            placeholder: step.metadata?.placeholder,
          }],
        },
        _orderIndex: i,
      });
    } else if (step.type === 'navigation' && step.url) {
      orderedSteps.push({
        id: nextId(),
        description: `Navigate to ${step.url}`,
        type: 'navigate',
        sourceStepIndices: [i],
        context: { url: step.url },
        _orderIndex: i,
      });
    }
  }

  // 5. Sort all steps by their original recording order, then push to final list
  orderedSteps.sort((a, b) => a._orderIndex - b._orderIndex);

  // Re-assign IDs in final order
  stepId = steps.length; // Continue from where pre-steps left off
  for (const os of orderedSteps) {
    const { _orderIndex, ...step } = os;
    step.id = nextId();
    steps.push(step);
  }

  // 6. Add final verification step
  if (testType === 'connection') {
    steps.push({
      id: nextId(),
      description: 'Verify wallet is connected via ethereum provider',
      type: 'verify_state',
      sourceStepIndices: [],
      context: { verification: 'wallet_connected' },
    });
  }

  return steps;
}
