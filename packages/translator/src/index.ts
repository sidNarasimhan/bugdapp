// Main entry point for the translator package

export * from './types.js';
export * from './analyzer.js';
export * from './claude-client.js';
export * from './prompt-builder.js';
export * from './code-generator.js';
export * from './validator.js';
export * from './clarification.js';

import { readFileSync } from 'fs';
import { RecordingSchema, type Recording, type TranslationResult, type GenerationOptions } from './types.js';
import { analyzeRecording } from './analyzer.js';
import { generateCode, type CodeGeneratorOptions } from './code-generator.js';
import { detectClarifications, runInteractiveClarification } from './clarification.js';
import { validateGeneratedCode } from './validator.js';

/**
 * Main translation function - converts a JSON recording to a Playwright/Synpress spec
 */
export async function translateRecording(
  recordingPath: string,
  options?: CodeGeneratorOptions & { interactive?: boolean }
): Promise<TranslationResult> {
  // Read and parse the recording
  const recordingData = readFileSync(recordingPath, 'utf-8');
  const rawRecording = JSON.parse(recordingData);

  // Validate the recording structure
  const parseResult = RecordingSchema.safeParse(rawRecording);
  if (!parseResult.success) {
    return {
      success: false,
      errors: [`Invalid recording format: ${parseResult.error.message}`],
    };
  }

  const recording = parseResult.data;

  // Analyze the recording
  const analysis = analyzeRecording(recording);

  // Check for clarifications if interactive mode
  if (options?.interactive) {
    const questions = detectClarifications(analysis);
    if (questions.length > 0) {
      await runInteractiveClarification(analysis);
    }
  }

  // Generate the code
  const result = await generateCode(analysis, options);

  return result;
}

/**
 * Parse a recording from a file path
 */
export function parseRecording(recordingPath: string): Recording {
  const recordingData = readFileSync(recordingPath, 'utf-8');
  const rawRecording = JSON.parse(recordingData);

  const parseResult = RecordingSchema.safeParse(rawRecording);
  if (!parseResult.success) {
    throw new Error(`Invalid recording format: ${parseResult.error.message}`);
  }

  return parseResult.data;
}

/**
 * Full translation pipeline with all steps exposed
 */
export async function translate(
  recording: Recording,
  options?: Partial<GenerationOptions> & CodeGeneratorOptions
): Promise<TranslationResult> {
  // Analyze
  const analysis = analyzeRecording(recording);

  // Generate
  const result = await generateCode(analysis, options);

  // Validate
  if (result.success && result.code) {
    const validation = await validateGeneratedCode(result.code);
    if (!validation.valid) {
      return {
        ...result,
        success: false,
        errors: validation.errors.map((e) => `Line ${e.line}: ${e.message}`),
        warnings: [
          ...(result.warnings || []),
          ...validation.warnings.map((w) => `Line ${w.line}: ${w.message}`),
        ],
      };
    }
  }

  return result;
}
