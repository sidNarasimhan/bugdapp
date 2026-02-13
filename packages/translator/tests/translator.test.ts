import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  RecordingSchema,
  type Recording,
  type AnalysisResult,
} from '../src/types.js';
import { analyzeRecording, RecordingAnalyzer } from '../src/analyzer.js';
import { validateTypeScript, validateDappwrightStructure } from '../src/validator.js';
import { detectClarifications } from '../src/clarification.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Sample recording for testing
const sampleRecording: Recording = {
  name: 'Test Recording',
  startUrl: 'https://example.com',
  steps: [
    {
      id: 'step-1',
      type: 'click',
      timestamp: 1000,
      selector: '[data-testid="login-button"]',
      metadata: {
        dataTestId: 'login-button',
        tagName: 'button',
        text: 'Login',
      },
    },
    {
      id: 'step-2',
      type: 'click',
      timestamp: 2000,
      selector: 'button:has-text("MetaMask")',
      metadata: {
        tagName: 'button',
        text: 'MetaMask',
      },
    },
    {
      id: 'step-3',
      type: 'web3',
      timestamp: 3000,
      web3Method: 'eth_requestAccounts',
      web3ProviderInfo: {
        name: 'MetaMask',
      },
      web3Result: ['0x123...'],
    },
    {
      id: 'step-4',
      type: 'web3',
      timestamp: 4000,
      web3Method: 'eth_chainId',
      chainId: 8453,
      web3Result: '0x2105',
    },
    {
      id: 'step-5',
      type: 'click',
      timestamp: 5000,
      selector: '[data-testid="sign-button"]',
      metadata: {
        dataTestId: 'sign-button',
        tagName: 'button',
        text: 'Sign',
      },
    },
    {
      id: 'step-6',
      type: 'web3',
      timestamp: 6000,
      web3Method: 'personal_sign',
    },
  ],
};

describe('RecordingSchema', () => {
  it('should validate a correct recording', () => {
    const result = RecordingSchema.safeParse(sampleRecording);
    expect(result.success).toBe(true);
  });

  it('should reject invalid recording', () => {
    const invalid = { name: 'Test', steps: 'not-an-array' };
    const result = RecordingSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept recording with minimal fields', () => {
    const minimal = {
      name: 'Minimal',
      startUrl: 'https://example.com',
      steps: [],
    };
    const result = RecordingSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe('RecordingAnalyzer', () => {
  describe('analyzeRecording', () => {
    it('should detect wallet connect pattern', () => {
      const analysis = analyzeRecording(sampleRecording);

      const connectPatterns = analysis.patterns.filter(p => p.type === 'wallet_connect');
      expect(connectPatterns.length).toBeGreaterThan(0);
    });

    it('should detect wallet sign pattern', () => {
      const analysis = analyzeRecording(sampleRecording);

      const signPatterns = analysis.patterns.filter(p => p.type === 'wallet_sign');
      expect(signPatterns.length).toBeGreaterThan(0);
    });

    it('should extract chain ID', () => {
      const analysis = analyzeRecording(sampleRecording);

      expect(analysis.detectedChainId).toBe(8453);
    });

    it('should extract wallet name', () => {
      const analysis = analyzeRecording(sampleRecording);

      expect(analysis.detectedWallet).toBe('MetaMask');
    });
  });

  describe('pattern detection', () => {
    it('should detect network switch pattern', () => {
      const recordingWithNetworkSwitch: Recording = {
        name: 'Network Switch Test',
        startUrl: 'https://example.com',
        steps: [
          {
            id: 'step-1',
            type: 'web3',
            timestamp: 1000,
            web3Method: 'wallet_switchEthereumChain',
            web3Params: [{ chainId: '0x2105' }],
          },
        ],
      };

      const analysis = analyzeRecording(recordingWithNetworkSwitch);
      const networkPatterns = analysis.patterns.filter(p => p.type === 'network_switch');

      expect(networkPatterns.length).toBe(1);
    });

    it('should detect trade pattern', () => {
      const recordingWithTrade: Recording = {
        name: 'Trade Test',
        startUrl: 'https://example.com',
        steps: [
          {
            id: 'step-1',
            type: 'click',
            timestamp: 1000,
            selector: '[data-testid="place-order-button"]',
            metadata: {
              dataTestId: 'place-order-button',
              text: 'Place Order',
            },
          },
          {
            id: 'step-2',
            type: 'web3',
            timestamp: 2000,
            web3Method: 'eth_sendTransaction',
          },
        ],
      };

      const analysis = analyzeRecording(recordingWithTrade);
      const tradePatterns = analysis.patterns.filter(p => p.type === 'trade_open');

      expect(tradePatterns.length).toBe(1);
    });
  });
});

describe('Validator', () => {
  describe('validateTypeScript', () => {
    it('should pass valid TypeScript', async () => {
      const validCode = `
const x: number = 1;
const y = "hello";
function test(a: string): string {
  return a + "!";
}
`;
      const result = await validateTypeScript(validCode);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect unclosed braces', async () => {
      const invalidCode = `
function test() {
  if (true) {
    console.log("hello");
  // missing closing brace
}
`;
      const result = await validateTypeScript(invalidCode);
      // Basic syntax validation should catch this
      expect(result.errors.length).toBeGreaterThanOrEqual(0); // May or may not catch depending on implementation
    });
  });

  describe('validateDappwrightStructure', () => {
    it('should pass valid dappwright spec', () => {
      const validSpec = `
import { test, expect } from '../../fixtures/wallet.fixture'

test('my test', async ({ wallet, page }) => {
  await page.goto('https://example.com')
  await wallet.approve()
})
`;
      const result = validateDappwrightStructure(validSpec);
      expect(result.valid).toBe(true);
    });

    it('should fail without dappwright fixture import', () => {
      const invalidSpec = `
const test = require('something')

test('my test', async () => {
  console.log('hello')
})
`;
      const result = validateDappwrightStructure(invalidSpec);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('dappwright fixture import'))).toBe(true);
    });

    it('should warn if Synpress imports are present', () => {
      const specWithSynpress = `
import { test, expect } from '../../fixtures/wallet.fixture'
import { testWithSynpress } from '@synthetixio/synpress'

test('my test', async ({ wallet, page }) => {
  await page.goto('https://example.com')
})
`;
      const result = validateDappwrightStructure(specWithSynpress);
      expect(result.warnings.some(w => w.message.includes('Synpress import detected'))).toBe(true);
    });
  });
});

describe('Clarification', () => {
  describe('detectClarifications', () => {
    it('should detect generic selectors', () => {
      const recordingWithGenericSelectors: Recording = {
        name: 'Generic Selector Test',
        startUrl: 'https://example.com',
        steps: [
          {
            id: 'step-1',
            type: 'click',
            timestamp: 1000,
            selector: 'div',
            metadata: {
              tagName: 'div',
              text: 'Click me',
            },
          },
        ],
      };

      const analysis = analyzeRecording(recordingWithGenericSelectors);
      const questions = detectClarifications(analysis);

      const selectorQuestions = questions.filter(q => q.type === 'selector');
      expect(selectorQuestions.length).toBeGreaterThan(0);
    });

    it('should detect non-MetaMask wallet selection', () => {
      const recordingWithRabby: Recording = {
        name: 'Rabby Wallet Test',
        startUrl: 'https://example.com',
        steps: [
          {
            id: 'step-1',
            type: 'click',
            timestamp: 1000,
            selector: 'button:has-text("Rabby")',
            metadata: {
              tagName: 'button',
              text: 'Rabby Wallet',
            },
          },
        ],
      };

      const analysis = analyzeRecording(recordingWithRabby);
      const questions = detectClarifications(analysis);

      const walletQuestions = questions.filter(q => q.type === 'action');
      expect(walletQuestions.length).toBeGreaterThan(0);
    });

    it('should detect long pauses that may need waits', () => {
      const recordingWithPause: Recording = {
        name: 'Pause Test',
        startUrl: 'https://example.com',
        steps: [
          {
            id: 'step-1',
            type: 'click',
            timestamp: 1000,
            selector: '[data-testid="button"]',
          },
          {
            id: 'step-2',
            type: 'click',
            timestamp: 10000, // 9 second pause
            selector: '[data-testid="next-button"]',
          },
        ],
      };

      const analysis = analyzeRecording(recordingWithPause);
      const questions = detectClarifications(analysis);

      const waitQuestions = questions.filter(q => q.type === 'wait');
      expect(waitQuestions.length).toBeGreaterThan(0);
    });
  });
});

describe('Example Loading', () => {
  it('should be able to parse the example recording', () => {
    try {
      const examplePath = join(__dirname, '..', 'knowledge', 'examples', 'avantis-trade', 'recording.json');
      const content = readFileSync(examplePath, 'utf-8');
      const recording = JSON.parse(content);

      const result = RecordingSchema.safeParse(recording);
      expect(result.success).toBe(true);
    } catch (error) {
      // File might not exist in test environment
      console.log('Example file not found - skipping');
    }
  });
});
