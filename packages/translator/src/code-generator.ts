import type { AnalysisResult, GenerationOptions, TranslationResult, FailureContext } from './types.js';
import { ClaudeClient, createClaudeClient } from './claude-client.js';
import { createPromptBuilder } from './prompt-builder.js';
import { validateTypeScript } from './validator.js';

export interface CodeGeneratorOptions extends Partial<GenerationOptions> {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  validateOutput?: boolean;
}

/**
 * Generates Playwright/dappwright code from analyzed recordings using Claude
 */
export class CodeGenerator {
  private client: ClaudeClient;
  private options: CodeGeneratorOptions;

  constructor(options: CodeGeneratorOptions = {}) {
    this.client = createClaudeClient({
      apiKey: options.apiKey,
      model: options.model,
      maxTokens: options.maxTokens,
    });
    this.options = options;
  }

  /**
   * Generate a complete test spec from an analysis result
   */
  async generate(analysis: AnalysisResult): Promise<TranslationResult> {
    const promptBuilder = createPromptBuilder(analysis, this.options);

    const systemPrompt = promptBuilder.buildSystemPrompt();
    const userPrompt = promptBuilder.buildUserPrompt();

    try {
      // Check if recording steps have screenshots for vision-based generation
      const stepScreenshots = analysis.recording.steps
        .filter((s): s is typeof s & { screenshot: string } => 'screenshot' in s && typeof (s as Record<string, unknown>).screenshot === 'string')
        .slice(0, 10) // Limit to 10 screenshots to manage token cost
        .map((s) => {
          // Strip data URL prefix if present
          const base64 = s.screenshot.replace(/^data:image\/\w+;base64,/, '');
          return { base64, mediaType: 'image/png' as const };
        });

      // Append success state screenshot if available
      const successState = (analysis.recording as unknown as { successState?: { markedSnapshot?: { screenshot?: string }; stopSnapshot?: { screenshot?: string } } }).successState;
      const successScreenshot = successState?.markedSnapshot?.screenshot || successState?.stopSnapshot?.screenshot;
      if (successScreenshot) {
        const base64 = successScreenshot.replace(/^data:image\/\w+;base64,/, '');
        stepScreenshots.push({ base64, mediaType: 'image/png' as const });
      }

      let code: string;
      if (stepScreenshots.length > 0) {
        const response = await this.client.generateCodeWithImages({
          systemPrompt,
          userPrompt,
          images: stepScreenshots,
          temperature: 0,
        });
        code = response.code;
      } else {
        const response = await this.client.generateCode({
          systemPrompt,
          userPrompt,
          temperature: 0,
        });
        code = response.code;
      }

      // Validate the generated TypeScript if requested
      if (this.options.validateOutput !== false) {
        const validation = await validateTypeScript(code);

        if (!validation.valid) {
          return {
            success: false,
            code,
            errors: validation.errors.map(
              (e) => `Line ${e.line}: ${e.message}`
            ),
            warnings: validation.warnings.map(
              (w) => `Line ${w.line}: ${w.message}`
            ),
            analysis,
          };
        }
      }

      // Post-process the code
      code = this.postProcessCode(code, analysis);

      return {
        success: true,
        code,
        warnings: analysis.warnings,
        analysis,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        errors: [`Code generation failed: ${errorMessage}`],
        analysis,
      };
    }
  }

  /**
   * Post-process generated code to fix common issues
   */
  private postProcessCode(code: string, _analysis: AnalysisResult): string {
    let processed = code;

    // Fix wrong import paths — specs are in test/playwright/, fixture is at fixtures/wallet.fixture
    // Correct relative path is ../../fixtures/wallet.fixture (TWO levels up)
    processed = processed.replace(
      /from ['"]\.\.\/fixtures\/wallet\.fixture['"]/g,
      "from '../../fixtures/wallet.fixture'"
    );

    // Strip any accidental Synpress imports
    processed = processed.replace(/^import .* from ['"]@synthetixio\/synpress.*['"];?\n/gm, '');

    // Strip any accidental direct dappwright imports
    processed = processed.replace(/^import .* from ['"]@tenkeylabs\/dappwright.*['"];?\n/gm, '');

    // Strip any leftover Synpress setup patterns
    processed = processed.replace(/^const test = testWithSynpress\(metaMaskFixtures\(.*\)\);?\n/gm, '');
    processed = processed.replace(/^const \{ expect \} = test;?\n/gm, '');

    // Ensure the correct dappwright fixture import is present
    if (!processed.includes("from '../../fixtures/wallet.fixture'")) {
      processed = `import { test, expect, raceApprove, raceSign } from '../../fixtures/wallet.fixture'\n\n` + processed;
    }

    // Ensure raceApprove is in the import if used in the code
    if (processed.includes('raceApprove') && !processed.includes('raceApprove}') && !processed.includes('raceApprove }') && !processed.includes('raceApprove,')) {
      processed = processed.replace(
        /import \{ ([^}]+) \} from '\.\.\/\.\.\/fixtures\/wallet\.fixture'/,
        (match, imports) => {
          if (!imports.includes('raceApprove')) {
            return `import { ${imports}, raceApprove } from '../../fixtures/wallet.fixture'`;
          }
          return match;
        }
      );
    }

    // Ensure raceSign is in the import if used in the code
    if (processed.includes('raceSign') && !processed.includes('raceSign}') && !processed.includes('raceSign }') && !processed.includes('raceSign,')) {
      processed = processed.replace(
        /import \{ ([^}]+) \} from '\.\.\/\.\.\/fixtures\/wallet\.fixture'/,
        (match, imports) => {
          if (!imports.includes('raceSign')) {
            return `import { ${imports}, raceSign } from '../../fixtures/wallet.fixture'`;
          }
          return match;
        }
      );
    }

    // Strip dynamic Radix/HeadlessUI IDs from selectors — they change every page load
    // e.g., div#radix-\:r4h\: > div:nth-child(3) p:nth-child(1) → useless
    // Remove entire .or(page.locator('...radix...')) calls to avoid syntax errors
    processed = processed.replace(/\s*\.or\(page\.locator\(['"][^'"]*#radix-[^'"]*['"]\)\)/g, '');

    // Ensure step markers are present for hybrid execution
    processed = this.addStepMarkers(processed);

    return processed;
  }

  /**
   * Insert STEP markers if none found, by detecting key patterns.
   * This is a fallback — the prompt instructs Claude to add them,
   * but if it forgets, this ensures hybrid mode still works.
   */
  private addStepMarkers(code: string): string {
    // If markers already exist, skip
    if (/\/\/\s*STEP\s+\d+:/.test(code)) return code;

    const lines = code.split('\n');
    const result: string[] = [];
    let stepNum = 0;
    let inTestBody = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect test body start
      if (!inTestBody && /test\s*\(/.test(line)) {
        inTestBody = true;
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
        result.push(line);
        continue;
      }

      if (inTestBody) {
        for (const ch of line) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }

        // Detect step-worthy lines and insert markers before them
        let markerDesc: string | null = null;

        if (/page\.goto\s*\(/.test(trimmed)) {
          const urlMatch = trimmed.match(/page\.goto\s*\(\s*['"]([^'"]+)['"]/);
          markerDesc = urlMatch ? `Navigate to ${urlMatch[1]}` : 'Navigate to page';
        } else if (/raceApprove\s*\(/.test(trimmed)) {
          markerDesc = 'Approve wallet connection';
        } else if (/raceSign\s*\(/.test(trimmed)) {
          markerDesc = 'Sign message';
        } else if (/wallet\.switchNetwork\s*\(/.test(trimmed)) {
          const nameMatch = trimmed.match(/wallet\.switchNetwork\s*\(\s*['"]([^'"]+)['"]/);
          markerDesc = nameMatch ? `Switch to ${nameMatch[1]} network` : 'Switch network';
        } else if (/wallet\.confirmTransaction\s*\(/.test(trimmed)) {
          markerDesc = 'Confirm transaction';
        }

        if (markerDesc) {
          stepNum++;
          // Get the indentation of the current line
          const indent = line.match(/^(\s*)/)?.[1] || '  ';
          result.push('');
          result.push(`${indent}// ========================================`);
          result.push(`${indent}// STEP ${stepNum}: ${markerDesc}`);
          result.push(`${indent}// ========================================`);
        }
      }

      result.push(line);
    }

    // Only return modified code if we actually added markers
    if (stepNum === 0) return code;
    return result.join('\n');
  }

  /**
   * Regenerate a spec using failure context (self-healing)
   */
  async regenerate(analysis: AnalysisResult, failureContext: FailureContext): Promise<TranslationResult> {
    const promptBuilder = createPromptBuilder(analysis, this.options);

    const systemPrompt = promptBuilder.buildSystemPrompt();
    const retryPrompt = promptBuilder.buildRetryPrompt(failureContext);

    try {
      // Use vision if screenshots are available
      const hasScreenshots = failureContext.screenshots.length > 0;

      let code: string;
      if (hasScreenshots) {
        const response = await this.client.generateCodeWithImages({
          systemPrompt,
          userPrompt: retryPrompt,
          images: failureContext.screenshots.map((s) => ({
            base64: s.base64,
            mediaType: s.mediaType,
          })),
          temperature: 0,
        });
        code = response.code;
      } else {
        const response = await this.client.generateCode({
          systemPrompt,
          userPrompt: retryPrompt,
          temperature: 0,
        });
        code = response.code;
      }

      // Post-process the code
      code = this.postProcessCode(code, analysis);

      // Validate
      if (this.options.validateOutput !== false) {
        const validation = await validateTypeScript(code);
        if (!validation.valid) {
          return {
            success: false,
            code,
            errors: validation.errors.map((e) => `Line ${e.line}: ${e.message}`),
            warnings: validation.warnings.map((w) => `Line ${w.line}: ${w.message}`),
            analysis,
          };
        }
      }

      return {
        success: true,
        code,
        warnings: [],
        analysis,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        errors: [`Regeneration failed: ${errorMessage}`],
        analysis,
      };
    }
  }

  /**
   * Generate code for a specific section of the recording
   */
  async generateSection(
    analysis: AnalysisResult,
    startIndex: number,
    endIndex: number
  ): Promise<TranslationResult> {
    const promptBuilder = createPromptBuilder(analysis, this.options);

    const systemPrompt = promptBuilder.buildSystemPrompt();
    const userPrompt = promptBuilder.buildSectionPrompt(startIndex, endIndex);

    try {
      const response = await this.client.generateCode({
        systemPrompt,
        userPrompt,
        temperature: 0,
      });

      return {
        success: true,
        code: response.code,
        analysis,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        errors: [`Section generation failed: ${errorMessage}`],
        analysis,
      };
    }
  }
}

/**
 * Create a code generator with the given options
 */
export function createCodeGenerator(options?: CodeGeneratorOptions): CodeGenerator {
  return new CodeGenerator(options);
}

/**
 * Generate code from an analysis result (convenience function)
 */
export async function generateCode(
  analysis: AnalysisResult,
  options?: CodeGeneratorOptions
): Promise<TranslationResult> {
  const generator = createCodeGenerator(options);
  return generator.generate(analysis);
}
