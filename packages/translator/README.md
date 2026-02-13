# @web3-test/translator

CLI tool to translate JSON recordings of Web3 dApp interactions into Playwright/Synpress test specs using LLM intelligence.

## Overview

This tool solves the pain points of converting recorded user interactions into reliable E2E tests for Web3 applications:

- **Iterative Process** → First-attempt working specs (70%+ target)
- **Implicit Knowledge** → Automatic handling of network switching, wallet popups
- **Synpress Reliability** → Custom MetaMask popup handlers that work reliably
- **Selector Brittleness** → Multiple fallback strategies for CSS-in-JS selectors

## Installation

```bash
npm install @web3-test/translator
```

Or use with npx:

```bash
npx @web3-test/translator generate ./recording.json
```

## Prerequisites

- Node.js 18+
- Anthropic API key (set `ANTHROPIC_API_KEY` environment variable)

## Usage

### Generate a Test Spec

```bash
# Basic translation
npx dapp-test-translator generate ./recording.json -o ./test.spec.ts

# Interactive mode (asks clarifying questions)
npx dapp-test-translator generate ./recording.json -i

# With custom API key
npx dapp-test-translator generate ./recording.json --api-key sk-ant-...
```

### Analyze a Recording

```bash
npx dapp-test-translator analyze ./recording.json
```

This shows:
- Detected flow patterns (connect, sign, trade, etc.)
- Chain ID and wallet used
- Step summary
- Potential clarifications needed

### Validate a Generated Spec

```bash
npx dapp-test-translator validate ./test.spec.ts
```

Checks:
- TypeScript syntax
- Synpress structure requirements
- Required imports and helpers

## How It Works

### Translation Pipeline

1. **Parse** - Validate JSON recording structure
2. **Analyze** - Detect flow patterns (wallet_connect, wallet_sign, trade_open, etc.)
3. **Build Prompt** - Construct LLM prompt with context and examples
4. **Generate** - Call Claude API to generate Playwright code
5. **Validate** - Check TypeScript validity and Synpress structure
6. **Post-process** - Ensure helpers and imports are present

### Pattern Detection

The analyzer detects these flow patterns:

| Pattern | Indicators |
|---------|------------|
| `wallet_connect` | `eth_requestAccounts`, connect/login buttons |
| `wallet_sign` | `personal_sign`, `eth_signTypedData_*` |
| `wallet_approve` | Approve buttons + `eth_sendTransaction` |
| `network_switch` | `wallet_switchEthereumChain` |
| `trade_open` | Trade/order buttons + transaction |
| `token_swap` | Swap buttons + transaction |
| `defi_deposit` | Deposit/stake buttons + transaction |

### MetaMask Popup Handling

Generated specs use custom helpers instead of unreliable Synpress methods:

```typescript
// Custom helper that actually works
async function handleMetaMaskPopup(context, buttonName, timeout = 10000) {
  // Polls for MetaMask notification popup
  // Clicks the specified button
  // Returns true/false
}

// Usage in test
await handleMetaMaskPopup(context, 'Connect')
await handleMetaMaskPopup(context, /confirm/i, 15000)
```

### Wallet Mapping

Recordings with Rabby, Coinbase, or other wallets are automatically mapped to MetaMask:

```typescript
// Recording clicked "Rabby Wallet"
// Generated spec clicks "MetaMask"
await page.getByText('MetaMask').click()
```

## Recording Format

Expected JSON structure:

```json
{
  "name": "Test Name",
  "startUrl": "https://example.com",
  "steps": [
    {
      "id": "step-1",
      "type": "click",
      "timestamp": 1234567890,
      "selector": "[data-testid='button']",
      "metadata": {
        "dataTestId": "button",
        "tagName": "button",
        "text": "Click Me"
      }
    },
    {
      "id": "step-2",
      "type": "web3",
      "timestamp": 1234567891,
      "web3Method": "eth_requestAccounts",
      "web3Result": ["0x..."]
    }
  ]
}
```

### Step Types

- `click` - User clicked an element
- `input` - User typed in an input
- `navigation` - Page navigation
- `web3` - Wallet method call
- `scroll` - Page scroll

## Knowledge Base

The package includes:

- `knowledge/networks.json` - Chain configurations
- `knowledge/patterns.json` - Flow pattern definitions
- `knowledge/examples/` - Few-shot examples for the LLM

### Adding Examples

Add new examples to improve generation accuracy:

```
knowledge/examples/your-dapp/
├── recording.json
└── spec.ts
```

## API Usage

```typescript
import { translateRecording, analyzeRecording, parseRecording } from '@web3-test/translator';

// Parse a recording file
const recording = parseRecording('./recording.json');

// Analyze patterns
const analysis = analyzeRecording(recording);
console.log(analysis.patterns);
console.log(analysis.detectedChainId);

// Generate spec
const result = await translateRecording('./recording.json', {
  apiKey: 'sk-ant-...',
  validateOutput: true,
});

if (result.success) {
  console.log(result.code);
} else {
  console.error(result.errors);
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## License

MIT
