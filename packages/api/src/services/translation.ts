import {
  RecordingSchema,
  analyzeRecording,
  generateCode,
  detectClarifications,
  type ClarificationQuestion,
} from '@web3-test/translator';

export interface TranslationServiceResult {
  success: boolean;
  code?: string;
  patterns?: Array<{
    type: string;
    startIndex: number;
    endIndex: number;
    confidence: number;
  }>;
  clarifications?: ClarificationQuestion[];
  warnings?: string[];
  errors?: string[];
  testType?: 'connection' | 'flow';
}

class TranslationService {
  /**
   * Generate a test spec from a recording stored in the database
   */
  async generateSpec(recording: {
    jsonData: unknown;
    name: string;
    dappUrl: string;
  }, options?: { dappContext?: string }): Promise<TranslationServiceResult> {
    // Parse the recording
    const parseResult = RecordingSchema.safeParse(recording.jsonData);
    if (!parseResult.success) {
      return {
        success: false,
        errors: [`Invalid recording format: ${parseResult.error.message}`],
      };
    }

    const recordingData = parseResult.data;

    // Analyze the recording
    const analysis = analyzeRecording(recordingData);

    // Detect clarifications
    const clarifications = detectClarifications(analysis);

    // Check if Anthropic API key is available
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        success: false,
        errors: ['ANTHROPIC_API_KEY environment variable is not set'],
        patterns: analysis.patterns.map((p) => ({
          type: p.type,
          startIndex: p.startIndex,
          endIndex: p.endIndex,
          confidence: p.confidence,
        })),
        clarifications: clarifications.length > 0 ? clarifications : undefined,
      };
    }

    try {
      // Generate the code
      const result = await generateCode(analysis, {
        validateOutput: true,
        dappContext: options?.dappContext,
      });

      if (!result.success) {
        return {
          success: false,
          errors: result.errors,
          warnings: result.warnings,
          patterns: analysis.patterns.map((p) => ({
            type: p.type,
            startIndex: p.startIndex,
            endIndex: p.endIndex,
            confidence: p.confidence,
          })),
        };
      }

      return {
        success: true,
        code: result.code,
        patterns: analysis.patterns.map((p) => ({
          type: p.type,
          startIndex: p.startIndex,
          endIndex: p.endIndex,
          confidence: p.confidence,
        })),
        clarifications: clarifications.length > 0 ? clarifications : undefined,
        warnings: result.warnings,
        testType: analysis.testType,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        errors: [`Generation failed: ${errorMessage}`],
        patterns: analysis.patterns.map((p) => ({
          type: p.type,
          startIndex: p.startIndex,
          endIndex: p.endIndex,
          confidence: p.confidence,
        })),
      };
    }
  }

  /**
   * Analyze a recording without generating code
   */
  analyzeRecording(jsonData: unknown): {
    success: boolean;
    analysis?: {
      patterns: Array<{
        type: string;
        startIndex: number;
        endIndex: number;
        confidence: number;
        metadata?: Record<string, unknown>;
      }>;
      chainId?: number;
      wallet?: string;
      warnings: string[];
    };
    errors?: string[];
  } {
    const parseResult = RecordingSchema.safeParse(jsonData);
    if (!parseResult.success) {
      return {
        success: false,
        errors: [`Invalid recording format: ${parseResult.error.message}`],
      };
    }

    const analysis = analyzeRecording(parseResult.data);

    return {
      success: true,
      analysis: {
        patterns: analysis.patterns.map((p) => ({
          type: p.type,
          startIndex: p.startIndex,
          endIndex: p.endIndex,
          confidence: p.confidence,
          metadata: p.metadata,
        })),
        chainId: analysis.detectedChainId,
        wallet: analysis.detectedWallet,
        warnings: analysis.warnings,
      },
    };
  }
}

export const translationService = new TranslationService();
