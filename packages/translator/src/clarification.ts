import type {
  AnalysisResult,
  ClarificationQuestion,
  ClarificationAnswer,
  ClickStep,
} from './types.js';
import inquirer from 'inquirer';

/**
 * Detects ambiguities in a recording that may require user clarification
 */
export class ClarificationDetector {
  private analysis: AnalysisResult;
  private questions: ClarificationQuestion[] = [];

  constructor(analysis: AnalysisResult) {
    this.analysis = analysis;
  }

  /**
   * Detect all ambiguities that need clarification
   */
  detectAmbiguities(): ClarificationQuestion[] {
    this.questions = [];

    this.detectSelectorAmbiguities();
    this.detectWaitAmbiguities();
    this.detectNetworkAmbiguities();
    this.detectActionAmbiguities();

    return this.questions;
  }

  /**
   * Detect ambiguous selectors that might not be unique
   */
  private detectSelectorAmbiguities(): void {
    const steps = this.analysis.recording.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === 'click') {
        const clickStep = step as ClickStep;

        // Check for generic selectors
        if (this.isGenericSelector(clickStep.selector)) {
          this.questions.push({
            id: `selector-${i}`,
            type: 'selector',
            question: `The selector "${clickStep.selector}" may not be unique. What alternative selector strategy should we use?`,
            context: `Step ${i + 1}: Click on "${clickStep.metadata?.text || 'element'}"`,
            stepIndex: i,
            options: [
              `Use text: "${clickStep.metadata?.text}"`,
              `Use data-testid if available`,
              `Use role + name combination`,
              `Keep original selector with .first()`,
            ],
            defaultAnswer: clickStep.metadata?.dataTestId
              ? `Use data-testid: "${clickStep.metadata.dataTestId}"`
              : `Use text: "${clickStep.metadata?.text}"`,
          });
        }

        // Check for CSS-in-JS generated class names
        if (this.hasCssInJsClass(clickStep.selector)) {
          this.questions.push({
            id: `cssjs-${i}`,
            type: 'selector',
            question: `The selector "${clickStep.selector}" contains dynamically generated class names that may change. How should we handle this?`,
            context: `Step ${i + 1}: Click on "${clickStep.metadata?.text || 'element'}"`,
            stepIndex: i,
            options: [
              'Use text content instead',
              'Use role-based selector',
              'Use parent element with stable selector',
              'Add data-testid to the element (requires code change)',
            ],
          });
        }
      }
    }
  }

  /**
   * Detect ambiguous wait conditions
   */
  private detectWaitAmbiguities(): void {
    const steps = this.analysis.recording.steps;

    // Check for rapid successive steps that might need waits
    for (let i = 1; i < steps.length; i++) {
      const prevStep = steps[i - 1];
      const currStep = steps[i];

      const timeDiff = currStep.timestamp - prevStep.timestamp;

      // If there's a long gap in the recording, user might have been waiting for something
      if (timeDiff > 5000) {
        this.questions.push({
          id: `wait-${i}`,
          type: 'wait',
          question: `There was a ${(timeDiff / 1000).toFixed(1)}s pause before this step. What should the test wait for?`,
          context: `Between step ${i} and ${i + 1}`,
          stepIndex: i,
          options: [
            'Wait for network request to complete',
            'Wait for specific element to appear',
            'Wait for loading indicator to disappear',
            `Use fixed timeout (${Math.ceil(timeDiff / 1000)}s)`,
          ],
        });
      }

      // After web3 calls, ask about confirmation waits
      if (prevStep.type === 'web3' && prevStep.web3Method === 'eth_sendTransaction') {
        this.questions.push({
          id: `txwait-${i}`,
          type: 'wait',
          question: 'How should we wait for transaction confirmation?',
          context: `After transaction at step ${i}`,
          stepIndex: i,
          options: [
            'Wait for success toast/notification',
            'Wait for balance update',
            'Wait for specific UI element change',
            'Use fixed timeout (10s)',
          ],
          defaultAnswer: 'Wait for success toast/notification',
        });
      }
    }
  }

  /**
   * Detect network-related ambiguities
   */
  private detectNetworkAmbiguities(): void {
    const { detectedChainId } = this.analysis;

    // If we detected a chain ID, ask about network handling
    if (detectedChainId && detectedChainId !== 1) {
      this.questions.push({
        id: 'network-setup',
        type: 'network',
        question: `The recording was made on chain ID ${detectedChainId}. How should the test handle network setup?`,
        context: 'Test initialization',
        options: [
          'Add network to MetaMask at start and switch to it',
          'Assume network is already configured',
          'Let dApp trigger network switch and approve in MetaMask',
        ],
        defaultAnswer: 'Let dApp trigger network switch and approve in MetaMask',
      });
    }
  }

  /**
   * Detect ambiguous user actions
   */
  private detectActionAmbiguities(): void {
    const steps = this.analysis.recording.steps;

    // Check for wallet selection that needs to be mapped
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === 'click') {
        const clickStep = step as ClickStep;
        const text = clickStep.metadata?.text?.toLowerCase() || '';

        // Non-MetaMask wallet selected in recording
        if (
          text.includes('rabby') ||
          text.includes('coinbase') ||
          text.includes('walletconnect') ||
          text.includes('rainbow')
        ) {
          this.questions.push({
            id: `wallet-${i}`,
            type: 'action',
            question: `The recording selected "${clickStep.metadata?.text}" wallet. The test will use MetaMask instead. Is this correct?`,
            context: `Step ${i + 1}: Wallet selection`,
            stepIndex: i,
            options: ['Yes, use MetaMask', 'Configure a different test wallet'],
            defaultAnswer: 'Yes, use MetaMask',
          });
        }
      }
    }

    // Check for approval patterns that might need token amount confirmation
    for (const pattern of this.analysis.patterns) {
      if (pattern.type === 'wallet_approve') {
        this.questions.push({
          id: `approve-${pattern.startIndex}`,
          type: 'action',
          question: 'Token approval detected. What approval amount should the test use?',
          context: `Approval flow at steps ${pattern.startIndex}-${pattern.endIndex}`,
          options: [
            'Approve exact amount needed',
            'Approve unlimited (max uint256)',
            'Use default amount from dApp',
          ],
          defaultAnswer: 'Use default amount from dApp',
        });
      }
    }
  }

  /**
   * Check if a selector is too generic
   */
  private isGenericSelector(selector: string): boolean {
    const genericPatterns = [
      /^div$/,
      /^button$/,
      /^span$/,
      /^a$/,
      /^div:nth-child\(\d+\)$/,
      /^button:nth-child\(\d+\)$/,
      /div\s+div\s+div/,
      /button\s+span$/,
    ];

    return genericPatterns.some((pattern) => pattern.test(selector));
  }

  /**
   * Check if selector contains CSS-in-JS generated class names
   */
  private hasCssInJsClass(selector: string): boolean {
    // Common CSS-in-JS patterns
    const cssInJsPatterns = [
      /\.[a-zA-Z]+_[a-zA-Z0-9]+__[a-zA-Z0-9]+/, // CSS Modules
      /\.css-[a-z0-9]+/, // Emotion/styled-components
      /\.sc-[a-zA-Z]+/, // styled-components
      /\.[a-zA-Z]+-[a-zA-Z0-9]{5,}/, // Tailwind JIT or similar
      /\.jsx?-\d+/, // JSS
    ];

    return cssInJsPatterns.some((pattern) => pattern.test(selector));
  }
}

/**
 * Interactive clarification handler using inquirer
 */
export class InteractiveClarification {
  private questions: ClarificationQuestion[];
  private answers: Map<string, ClarificationAnswer> = new Map();

  constructor(questions: ClarificationQuestion[]) {
    this.questions = questions;
  }

  /**
   * Prompt user for all clarifications interactively
   */
  async promptAll(): Promise<ClarificationAnswer[]> {
    if (this.questions.length === 0) {
      return [];
    }

    console.log('\n📋 Some aspects of the recording need clarification:\n');

    for (const question of this.questions) {
      const answer = await this.promptQuestion(question);
      this.answers.set(question.id, answer);
    }

    return Array.from(this.answers.values());
  }

  /**
   * Prompt for a single question
   */
  private async promptQuestion(question: ClarificationQuestion): Promise<ClarificationAnswer> {
    console.log(`\n${question.context}`);

    const { answer } = await inquirer.prompt([
      {
        type: 'list',
        name: 'answer',
        message: question.question,
        choices: question.options || ['Yes', 'No'],
        default: question.defaultAnswer,
      },
    ]);

    return {
      questionId: question.id,
      answer,
    };
  }

  /**
   * Get a specific answer by question ID
   */
  getAnswer(questionId: string): ClarificationAnswer | undefined {
    return this.answers.get(questionId);
  }

  /**
   * Get all answers
   */
  getAllAnswers(): ClarificationAnswer[] {
    return Array.from(this.answers.values());
  }
}

/**
 * Detect clarifications needed for a recording
 */
export function detectClarifications(analysis: AnalysisResult): ClarificationQuestion[] {
  const detector = new ClarificationDetector(analysis);
  return detector.detectAmbiguities();
}

/**
 * Run interactive clarification session
 */
export async function runInteractiveClarification(
  analysis: AnalysisResult
): Promise<ClarificationAnswer[]> {
  const questions = detectClarifications(analysis);

  if (questions.length === 0) {
    console.log('✅ No clarifications needed - recording is unambiguous');
    return [];
  }

  const handler = new InteractiveClarification(questions);
  return handler.promptAll();
}
