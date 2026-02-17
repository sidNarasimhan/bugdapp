import type {
  Recording,
  RecordingStep,
  FlowPattern,
  FlowPatternType,
  AnalysisResult,
  ClickStep,
  DappConnectionPattern,
} from './types.js';

/**
 * Analyzes a recording to detect flow patterns like wallet connect, sign, approve, etc.
 * This helps the LLM understand the user's intent and generate better code.
 */
export class RecordingAnalyzer {
  private recording: Recording;
  private patterns: FlowPattern[] = [];
  private warnings: string[] = [];

  constructor(recording: Recording) {
    this.recording = recording;
  }

  /**
   * Main analysis entry point
   */
  analyze(): AnalysisResult {
    this.patterns = [];
    this.warnings = [];

    // Detect all patterns in the recording
    this.detectWalletConnectPattern();
    this.detectWalletSignPatterns();
    this.detectNetworkSwitchPatterns();
    this.detectTradePatterns();
    this.detectApprovalPatterns();
    this.detectFormFillPatterns();
    this.detectNavigationPatterns();

    // Sort patterns by start index
    this.patterns.sort((a, b) => a.startIndex - b.startIndex);

    // Extract chain ID and wallet info
    const detectedChainId = this.extractChainId();
    const detectedWallet = this.extractWalletName();

    // Generate import suggestions based on patterns
    const suggestedImports = this.generateImportSuggestions();

    // Classify test type
    const testType = this.classifyTestType();

    // Detect dApp connection pattern
    const dappConnectionPattern = this.detectDappConnectionPattern();

    return {
      recording: this.recording,
      patterns: this.patterns,
      detectedChainId,
      detectedWallet,
      suggestedImports,
      warnings: this.warnings,
      // Pass through wallet connection state from recording
      walletConnected: this.recording.walletConnected || false,
      walletAddress: this.recording.walletAddress,
      testType,
      dappConnectionPattern,
    };
  }

  /**
   * Classify whether this is a connection test or a flow test
   * - walletConnected=false + has eth_requestAccounts -> connection test
   * - walletConnected=true -> flow test (wallet was already connected during recording)
   */
  private classifyTestType(): 'connection' | 'flow' {
    const walletConnected = this.recording.walletConnected || false;
    const hasRequestAccounts = this.recording.steps.some(
      (step) => step.type === 'web3' && step.web3Method === 'eth_requestAccounts'
    );

    // Explicit wallet-was-connected flag from recording
    if (walletConnected && !hasRequestAccounts) {
      return 'flow';
    }

    // Heuristic: if NO eth_requestAccounts AND no connection-like click steps,
    // this is likely a flow test where the extension failed to detect the wallet.
    // Connection recordings always have at least one of: login/connect/wallet click + eth_requestAccounts.
    if (!hasRequestAccounts) {
      const connectionKeywords = ['connect', 'login', 'sign in', 'launch app', 'enter app'];
      const hasConnectionClicks = this.recording.steps.some((step) => {
        if (step.type !== 'click') return false;
        const text = (step as ClickStep).metadata?.text?.toLowerCase() || '';
        return connectionKeywords.some((kw) => text.includes(kw));
      });

      if (!hasConnectionClicks) {
        return 'flow';
      }
    }

    return 'connection';
  }

  /**
   * Detect which dApp connection pattern is being used (RainbowKit, Web3Modal, custom)
   */
  private detectDappConnectionPattern(): DappConnectionPattern {
    const clickSteps = this.recording.steps.filter(
      (s): s is ClickStep => s.type === 'click'
    );

    for (const step of clickSteps) {
      const selector = step.selector || '';
      const testId = step.metadata?.dataTestId || '';
      const text = step.metadata?.text?.toLowerCase() || '';
      const className = step.metadata?.className || '';

      // Privy detection
      if (
        selector.includes('privy-') ||
        selector.includes('#privy-modal-content') ||
        selector.includes('#privy-dialog') ||
        testId.includes('login-button') ||
        className.includes('privy') ||
        text.includes('continue with a wallet')
      ) {
        return 'privy';
      }

      // RainbowKit detection
      if (
        selector.includes('rk-') ||
        testId.includes('rk-') ||
        className.includes('rk-') ||
        selector.includes('rainbowkit')
      ) {
        return 'rainbowkit';
      }

      // Web3Modal detection
      if (
        selector.includes('w3m-') ||
        testId.includes('w3m-') ||
        selector.includes('web3modal') ||
        text.includes('walletconnect')
      ) {
        return 'web3modal';
      }
    }

    // If we have wallet connection steps but no known pattern, it's custom
    const hasConnectionSteps = this.patterns.some((p) => p.type === 'wallet_connect');
    if (hasConnectionSteps) {
      return 'custom';
    }

    return 'unknown';
  }

  /**
   * Detect wallet connection patterns (eth_requestAccounts)
   */
  private detectWalletConnectPattern(): void {
    const steps = this.recording.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'web3' && step.web3Method === 'eth_requestAccounts') {
        // Look backwards for click steps that might be wallet selection
        const connectSteps: RecordingStep[] = [step];
        let startIndex = i;

        // Find preceding click steps (wallet button clicks)
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const prevStep = steps[j];
          if (prevStep.type === 'click') {
            const text = (prevStep as ClickStep).metadata?.text?.toLowerCase() || '';
            if (
              text.includes('connect') ||
              text.includes('wallet') ||
              text.includes('login') ||
              text.includes('metamask') ||
              text.includes('rabby')
            ) {
              connectSteps.unshift(prevStep);
              startIndex = j;
            }
          }
        }

        this.patterns.push({
          type: 'wallet_connect',
          startIndex,
          endIndex: i,
          steps: connectSteps,
          confidence: 0.9,
          metadata: {
            walletName: step.web3ProviderInfo?.name,
          },
        });
      }
    }
  }

  /**
   * Detect signature request patterns (personal_sign, eth_signTypedData, etc.)
   */
  private detectWalletSignPatterns(): void {
    const signMethods = [
      'personal_sign',
      'eth_sign',
      'eth_signTypedData',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4',
    ];

    const steps = this.recording.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'web3' && signMethods.includes(step.web3Method)) {
        // Look backwards for click steps that triggered the sign
        let startIndex = i;
        const signSteps: RecordingStep[] = [];

        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const prevStep = steps[j];
          if (prevStep.type === 'click') {
            const text = (prevStep as ClickStep).metadata?.text?.toLowerCase() || '';
            if (text.includes('sign') || text.includes('confirm') || text.includes('agree')) {
              signSteps.unshift(prevStep);
              startIndex = j;
              break;
            }
          }
        }

        signSteps.push(step);

        this.patterns.push({
          type: 'wallet_sign',
          startIndex,
          endIndex: i,
          steps: signSteps,
          confidence: 0.95,
        });
      }
    }
  }

  /**
   * Detect network switch patterns (wallet_switchEthereumChain, wallet_addEthereumChain)
   */
  private detectNetworkSwitchPatterns(): void {
    const networkMethods = ['wallet_switchEthereumChain', 'wallet_addEthereumChain'];

    const steps = this.recording.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'web3' && networkMethods.includes(step.web3Method)) {
        let chainId: number | undefined;

        // Extract chain ID from params
        if (step.web3Params && Array.isArray(step.web3Params) && step.web3Params[0]) {
          const hexChainId = step.web3Params[0].chainId;
          if (hexChainId) {
            chainId = parseInt(hexChainId, 16);
          }
        }

        this.patterns.push({
          type: 'network_switch',
          startIndex: i,
          endIndex: i,
          steps: [step],
          confidence: 0.95,
          metadata: { chainId },
        });
      }
    }

    // Also detect implicit network switches from eth_chainId result changes
    let lastChainHex: string | undefined;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'web3' && step.web3Method === 'eth_chainId' && step.web3Result) {
        const hexResult = typeof step.web3Result === 'string' ? step.web3Result : undefined;
        if (hexResult) {
          if (lastChainHex && hexResult !== lastChainHex) {
            // Chain changed — implicit network switch
            const chainId = parseInt(hexResult, 16);
            // Only add if no explicit network_switch pattern already covers this
            const alreadyDetected = this.patterns.some(
              (p) => p.type === 'network_switch' && (p.metadata as { chainId?: number })?.chainId === chainId
            );
            if (!alreadyDetected) {
              this.patterns.push({
                type: 'network_switch',
                startIndex: i,
                endIndex: i,
                steps: [step],
                confidence: 0.8,
                metadata: { chainId, implicit: true, fromChain: parseInt(lastChainHex, 16) },
              });
            }
          }
          lastChainHex = hexResult;
        }
      }
    }
  }

  /**
   * Detect trading patterns (placing orders, opening/closing positions)
   */
  private detectTradePatterns(): void {
    const steps = this.recording.steps;
    const tradeKeywords = ['trade', 'order', 'place', 'buy', 'sell', 'long', 'short', 'leverage'];
    const confirmKeywords = ['confirm', 'submit', 'execute'];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'click') {
        const text = step.metadata?.text?.toLowerCase() || '';
        const testId = step.metadata?.dataTestId?.toLowerCase() || '';

        // Check for trade-related clicks
        const isTradeClick = tradeKeywords.some(
          (keyword) => text.includes(keyword) || testId.includes(keyword)
        );

        const isConfirmClick = confirmKeywords.some(
          (keyword) => text.includes(keyword) || testId.includes(keyword)
        );

        if (isTradeClick || isConfirmClick) {
          // Look ahead for eth_sendTransaction
          for (let j = i + 1; j < Math.min(steps.length, i + 5); j++) {
            const nextStep = steps[j];
            if (nextStep.type === 'web3' && nextStep.web3Method === 'eth_sendTransaction') {
              this.patterns.push({
                type: 'trade_open',
                startIndex: i,
                endIndex: j,
                steps: steps.slice(i, j + 1),
                confidence: 0.85,
              });
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Detect token approval patterns
   */
  private detectApprovalPatterns(): void {
    const steps = this.recording.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'click') {
        const text = step.metadata?.text?.toLowerCase() || '';
        const testId = step.metadata?.dataTestId?.toLowerCase() || '';

        if (text.includes('approve') || testId.includes('approve')) {
          // Look ahead for eth_sendTransaction
          for (let j = i + 1; j < Math.min(steps.length, i + 5); j++) {
            const nextStep = steps[j];
            if (nextStep.type === 'web3' && nextStep.web3Method === 'eth_sendTransaction') {
              this.patterns.push({
                type: 'wallet_approve',
                startIndex: i,
                endIndex: j,
                steps: steps.slice(i, j + 1),
                confidence: 0.9,
              });
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Detect form fill patterns (input sequences)
   */
  private detectFormFillPatterns(): void {
    const steps = this.recording.steps;
    let formStart: number | null = null;
    let formSteps: RecordingStep[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === 'input') {
        if (formStart === null) {
          formStart = i;
        }
        formSteps.push(step);
      } else if (formStart !== null) {
        // Check if this is the end of a form
        if (formSteps.length >= 2) {
          this.patterns.push({
            type: 'form_fill',
            startIndex: formStart,
            endIndex: i - 1,
            steps: formSteps,
            confidence: 0.7,
          });
        }
        formStart = null;
        formSteps = [];
      }
    }
  }

  /**
   * Detect navigation patterns
   */
  private detectNavigationPatterns(): void {
    const steps = this.recording.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'navigation') {
        this.patterns.push({
          type: 'navigation',
          startIndex: i,
          endIndex: i,
          steps: [step],
          confidence: 1.0,
          metadata: {
            url: step.url,
          },
        });
      }
    }
  }

  /**
   * Extract chain ID from Web3 steps
   */
  private extractChainId(): number | undefined {
    for (const step of this.recording.steps) {
      if (step.type === 'web3') {
        // Check for chainId in the step
        if (step.chainId) {
          return step.chainId;
        }

        // Check eth_chainId result
        if (step.web3Method === 'eth_chainId' && step.web3Result) {
          const hex = step.web3Result as string;
          return parseInt(hex, 16);
        }
      }
    }
    return undefined;
  }

  /**
   * Extract wallet name from Web3 steps
   */
  private extractWalletName(): string | undefined {
    for (const step of this.recording.steps) {
      if (step.type === 'web3' && step.web3ProviderInfo?.name) {
        return step.web3ProviderInfo.name;
      }
    }
    return undefined;
  }

  /**
   * Generate import suggestions based on detected patterns
   */
  private generateImportSuggestions(): string[] {
    const imports: Set<string> = new Set([
      "import { test, expect } from '../../fixtures/wallet.fixture'",
    ]);

    // Add additional imports based on patterns
    const patternTypes = new Set(this.patterns.map((p) => p.type));

    if (patternTypes.has('network_switch')) {
      // Network switch might need additional helpers
    }

    return Array.from(imports);
  }

  /**
   * Get patterns of a specific type
   */
  getPatternsByType(type: FlowPatternType): FlowPattern[] {
    return this.patterns.filter((p) => p.type === type);
  }

  /**
   * Check if recording contains a specific pattern type
   */
  hasPattern(type: FlowPatternType): boolean {
    return this.patterns.some((p) => p.type === type);
  }

  /**
   * Get the primary flow type (most significant pattern)
   */
  getPrimaryFlowType(): FlowPatternType {
    const priorities: FlowPatternType[] = [
      'trade_open',
      'trade_close',
      'token_swap',
      'defi_deposit',
      'defi_withdraw',
      'nft_mint',
      'wallet_approve',
      'wallet_sign',
      'wallet_connect',
      'form_fill',
      'navigation',
    ];

    for (const type of priorities) {
      if (this.hasPattern(type)) {
        return type;
      }
    }

    return 'unknown';
  }
}

/**
 * Convenience function to analyze a recording
 */
export function analyzeRecording(recording: Recording): AnalysisResult {
  const analyzer = new RecordingAnalyzer(recording);
  return analyzer.analyze();
}
