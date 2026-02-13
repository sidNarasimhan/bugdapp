import type { ValidationResult } from './types.js';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

/**
 * Validates TypeScript code by attempting to compile it
 */
export async function validateTypeScript(code: string): Promise<ValidationResult> {
  const errors: Array<{ line: number; column: number; message: string }> = [];
  const warnings: Array<{ line: number; column: number; message: string }> = [];

  // Create a temporary file for validation
  const tempDir = join(tmpdir(), 'translator-validate');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const tempFile = join(tempDir, `validate-${randomBytes(8).toString('hex')}.ts`);

  try {
    // Write the code to a temp file
    writeFileSync(tempFile, code);

    // Try to compile with TypeScript
    const result = await runTypeScriptCheck(tempFile);

    // Parse the output for errors
    for (const line of result.output.split('\n')) {
      const match = line.match(/\((\d+),(\d+)\):\s*(error|warning)\s+TS(\d+):\s*(.+)/);
      if (match) {
        const errorCode = match[4];
        const message = match[5];

        // Skip errors that are expected when validating outside a dappwright project:
        // TS2307: Cannot find module (external deps not installed)
        // TS1259: Module can only be default-imported (esModuleInterop)
        // TS2339: Property does not exist (dappwright fixtures)
        // TS2532: Object is possibly undefined (strict mode)
        // TS7016: Could not find declaration file
        // TS2802: Requires downlevelIteration (tsconfig issue)
        const ignoredErrorCodes = ['2307', '1259', '2339', '2532', '7016', '2802'];
        if (ignoredErrorCodes.includes(errorCode)) {
          continue;
        }

        const entry = {
          line: parseInt(match[1], 10),
          column: parseInt(match[2], 10),
          message,
        };

        if (match[3] === 'error') {
          errors.push(entry);
        } else {
          warnings.push(entry);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    // If TypeScript check fails, try basic syntax validation
    const syntaxResult = validateSyntax(code);
    return syntaxResult;
  } finally {
    // Clean up temp file
    try {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run TypeScript compiler for type checking
 */
async function runTypeScriptCheck(filePath: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const tsc = spawn('npx', ['tsc', '--noEmit', '--skipLibCheck', filePath], {
      shell: true,
      timeout: 30000,
    });

    let output = '';

    tsc.stdout.on('data', (data) => {
      output += data.toString();
    });

    tsc.stderr.on('data', (data) => {
      output += data.toString();
    });

    tsc.on('close', (code) => {
      resolve({
        success: code === 0,
        output,
      });
    });

    tsc.on('error', () => {
      resolve({
        success: false,
        output: 'TypeScript compiler not available',
      });
    });
  });
}

/**
 * Basic syntax validation without full TypeScript compilation
 */
function validateSyntax(code: string): ValidationResult {
  const errors: Array<{ line: number; column: number; message: string }> = [];
  const warnings: Array<{ line: number; column: number; message: string }> = [];

  // Check for common syntax issues
  const lines = code.split('\n');

  let braceCount = 0;
  let parenCount = 0;
  let bracketCount = 0;
  let inString = false;
  let stringChar = '';

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    for (let col = 0; col < line.length; col++) {
      const char = line[col];
      const prevChar = col > 0 ? line[col - 1] : '';

      // Handle strings
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
        continue;
      }

      if (inString) continue;

      // Count braces
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;

      // Check for negative counts (extra closing)
      if (braceCount < 0) {
        errors.push({
          line: lineNum + 1,
          column: col + 1,
          message: 'Unexpected closing brace',
        });
        braceCount = 0;
      }
      if (parenCount < 0) {
        errors.push({
          line: lineNum + 1,
          column: col + 1,
          message: 'Unexpected closing parenthesis',
        });
        parenCount = 0;
      }
      if (bracketCount < 0) {
        errors.push({
          line: lineNum + 1,
          column: col + 1,
          message: 'Unexpected closing bracket',
        });
        bracketCount = 0;
      }
    }
  }

  // Check for unclosed braces at end
  if (braceCount > 0) {
    errors.push({
      line: lines.length,
      column: 1,
      message: `${braceCount} unclosed brace(s)`,
    });
  }
  if (parenCount > 0) {
    errors.push({
      line: lines.length,
      column: 1,
      message: `${parenCount} unclosed parenthesis(es)`,
    });
  }
  if (bracketCount > 0) {
    errors.push({
      line: lines.length,
      column: 1,
      message: `${bracketCount} unclosed bracket(s)`,
    });
  }

  // Check for common issues
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Check for trailing commas before closing braces/brackets
    if (/,\s*[}\]]/.test(line)) {
      // This is actually valid in modern JS/TS, but we can warn
    }

    // Check for missing semicolons (in non-control flow statements)
    const trimmed = line.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.endsWith('{') &&
      !trimmed.endsWith('}') &&
      !trimmed.endsWith(',') &&
      !trimmed.endsWith(';') &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('/*') &&
      !trimmed.endsWith('*/') &&
      !trimmed.match(/^(if|else|for|while|do|switch|try|catch|finally|function|class|interface|type|import|export|const|let|var|return|throw|await)\b/)
    ) {
      // Might be missing semicolon - just a warning
      // Actually, TypeScript doesn't require semicolons, so skip this
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate that the code contains required elements for a dappwright test
 */
export function validateDappwrightStructure(code: string): ValidationResult {
  const errors: Array<{ line: number; column: number; message: string }> = [];
  const warnings: Array<{ line: number; column: number; message: string }> = [];

  // Check for required fixture import
  if (!code.includes("from '../../fixtures/wallet.fixture'") && !code.includes('from "../../fixtures/wallet.fixture"')) {
    errors.push({
      line: 1,
      column: 1,
      message: "Missing dappwright fixture import: import { test, expect } from '../../fixtures/wallet.fixture'",
    });
  }

  // Check for at least one test case
  if (!code.includes("test('") && !code.includes('test("') && !code.includes('test(`')) {
    errors.push({
      line: 1,
      column: 1,
      message: 'Missing test case: test(...) block not found',
    });
  }

  // Warn if Synpress imports are present (should have been stripped)
  if (code.includes("from '@synthetixio/synpress'")) {
    warnings.push({
      line: 1,
      column: 1,
      message: 'Synpress import detected — should use dappwright fixture import instead',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Combined validation function
 */
export async function validateGeneratedCode(code: string): Promise<ValidationResult> {
  // First check TypeScript syntax
  const tsResult = await validateTypeScript(code);

  // Then check dappwright structure
  const dappwrightResult = validateDappwrightStructure(code);

  return {
    valid: tsResult.valid && dappwrightResult.valid,
    errors: [...tsResult.errors, ...dappwrightResult.errors],
    warnings: [...tsResult.warnings, ...dappwrightResult.warnings],
  };
}
