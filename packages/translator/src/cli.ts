#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';

import { translateRecording, parseRecording } from './index.js';
import { analyzeRecording } from './analyzer.js';
import { validateGeneratedCode } from './validator.js';
import { detectClarifications, runInteractiveClarification } from './clarification.js';

const program = new Command();

program
  .name('dapp-test-translator')
  .description('Translate JSON recordings to Playwright/Synpress test specs for Web3 dApps')
  .version('1.0.0');

// Generate command
program
  .command('generate <recording>')
  .description('Generate a Playwright/Synpress spec from a JSON recording')
  .option('-o, --output <file>', 'Output file path (default: <recording-name>.spec.ts)')
  .option('-i, --interactive', 'Run in interactive mode to answer clarifying questions')
  .option('--no-validate', 'Skip TypeScript validation of generated code')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env var)')
  .option('--model <model>', 'Claude model to use (default: claude-sonnet-4-20250514)')
  .action(async (recordingPath: string, options) => {
    const spinner = ora('Reading recording...').start();

    try {
      // Resolve the recording path
      const fullPath = resolve(recordingPath);

      if (!existsSync(fullPath)) {
        spinner.fail(chalk.red(`Recording file not found: ${fullPath}`));
        process.exit(1);
      }

      spinner.text = 'Parsing recording...';

      // Parse the recording
      const recording = parseRecording(fullPath);

      spinner.succeed(
        chalk.green(`Loaded recording: ${recording.name} (${recording.steps.length} steps)`)
      );

      // Analyze the recording
      const analysisSpinner = ora('Analyzing recording patterns...').start();
      const analysis = analyzeRecording(recording);

      const patternSummary = analysis.patterns
        .map((p) => `${p.type} (${(p.confidence * 100).toFixed(0)}%)`)
        .join(', ');

      analysisSpinner.succeed(
        chalk.green(`Detected patterns: ${patternSummary || 'none'}`)
      );

      if (analysis.detectedChainId) {
        console.log(chalk.cyan(`  Chain ID: ${analysis.detectedChainId}`));
      }
      if (analysis.detectedWallet) {
        console.log(chalk.cyan(`  Recorded wallet: ${analysis.detectedWallet}`));
      }

      // Interactive clarifications if requested
      if (options.interactive) {
        const questions = detectClarifications(analysis);
        if (questions.length > 0) {
          console.log('');
          await runInteractiveClarification(analysis);
          console.log('');
        }
      }

      // Generate the code
      const genSpinner = ora('Generating test spec with Claude...').start();

      const result = await translateRecording(fullPath, {
        apiKey: options.apiKey,
        model: options.model,
        validateOutput: options.validate !== false,
        interactive: false, // We already handled this
      });

      if (!result.success) {
        genSpinner.fail(chalk.red('Code generation failed'));
        console.log('');
        for (const error of result.errors || []) {
          console.log(chalk.red(`  ✗ ${error}`));
        }
        process.exit(1);
      }

      genSpinner.succeed(chalk.green('Code generated successfully'));

      // Show warnings
      if (result.warnings && result.warnings.length > 0) {
        console.log('');
        console.log(chalk.yellow('Warnings:'));
        for (const warning of result.warnings) {
          console.log(chalk.yellow(`  ⚠ ${warning}`));
        }
      }

      // Determine output path
      const outputPath =
        options.output ||
        resolve(
          basename(recordingPath).replace(/\.json$/, '') + '.spec.ts'
        );

      // Write the output
      writeFileSync(outputPath, result.code!);

      console.log('');
      console.log(chalk.green(`✓ Generated spec saved to: ${outputPath}`));
      console.log('');
      console.log(chalk.gray('Next steps:'));
      console.log(chalk.gray('  1. Review the generated spec'));
      console.log(chalk.gray('  2. Run: npx playwright test ' + outputPath));
    } catch (error) {
      spinner.fail(chalk.red('Error'));
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error')
      );
      process.exit(1);
    }
  });

// Analyze command
program
  .command('analyze <recording>')
  .description('Analyze a recording and show detected patterns')
  .action(async (recordingPath: string) => {
    const spinner = ora('Analyzing recording...').start();

    try {
      const fullPath = resolve(recordingPath);

      if (!existsSync(fullPath)) {
        spinner.fail(chalk.red(`Recording file not found: ${fullPath}`));
        process.exit(1);
      }

      const recording = parseRecording(fullPath);
      const analysis = analyzeRecording(recording);

      spinner.succeed(chalk.green('Analysis complete'));

      console.log('');
      console.log(chalk.bold('Recording Information:'));
      console.log(`  Name: ${recording.name}`);
      console.log(`  Start URL: ${recording.startUrl}`);
      console.log(`  Steps: ${recording.steps.length}`);

      if (analysis.detectedChainId) {
        console.log(`  Chain ID: ${analysis.detectedChainId}`);
      }
      if (analysis.detectedWallet) {
        console.log(`  Wallet: ${analysis.detectedWallet}`);
      }

      console.log('');
      console.log(chalk.bold('Detected Patterns:'));

      if (analysis.patterns.length === 0) {
        console.log(chalk.gray('  No specific patterns detected'));
      } else {
        for (const pattern of analysis.patterns) {
          const confidence = (pattern.confidence * 100).toFixed(0);
          console.log(
            `  ${chalk.cyan(pattern.type)} (steps ${pattern.startIndex}-${pattern.endIndex}, ${confidence}% confidence)`
          );
          if (pattern.metadata) {
            for (const [key, value] of Object.entries(pattern.metadata)) {
              if (value !== undefined) {
                console.log(chalk.gray(`    ${key}: ${value}`));
              }
            }
          }
        }
      }

      console.log('');
      console.log(chalk.bold('Step Summary:'));

      const stepTypes = new Map<string, number>();
      for (const step of recording.steps) {
        stepTypes.set(step.type, (stepTypes.get(step.type) || 0) + 1);
      }

      for (const [type, count] of stepTypes.entries()) {
        console.log(`  ${type}: ${count}`);
      }

      if (analysis.warnings.length > 0) {
        console.log('');
        console.log(chalk.yellow('Warnings:'));
        for (const warning of analysis.warnings) {
          console.log(chalk.yellow(`  ⚠ ${warning}`));
        }
      }

      // Check for clarifications
      const questions = detectClarifications(analysis);
      if (questions.length > 0) {
        console.log('');
        console.log(
          chalk.yellow(
            `${questions.length} clarification(s) would be needed for generation.`
          )
        );
        console.log(
          chalk.gray('  Use --interactive flag with generate command to answer them.')
        );
      }
    } catch (error) {
      spinner.fail(chalk.red('Error'));
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error')
      );
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate <spec>')
  .description('Validate a generated test spec')
  .action(async (specPath: string) => {
    const spinner = ora('Validating spec...').start();

    try {
      const fullPath = resolve(specPath);

      if (!existsSync(fullPath)) {
        spinner.fail(chalk.red(`Spec file not found: ${fullPath}`));
        process.exit(1);
      }

      const code = readFileSync(fullPath, 'utf-8');
      const result = await validateGeneratedCode(code);

      if (result.valid) {
        spinner.succeed(chalk.green('Spec is valid'));
      } else {
        spinner.fail(chalk.red('Validation failed'));
      }

      if (result.errors.length > 0) {
        console.log('');
        console.log(chalk.red('Errors:'));
        for (const error of result.errors) {
          console.log(chalk.red(`  Line ${error.line}: ${error.message}`));
        }
      }

      if (result.warnings.length > 0) {
        console.log('');
        console.log(chalk.yellow('Warnings:'));
        for (const warning of result.warnings) {
          console.log(chalk.yellow(`  Line ${warning.line}: ${warning.message}`));
        }
      }

      if (!result.valid) {
        process.exit(1);
      }
    } catch (error) {
      spinner.fail(chalk.red('Error'));
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error')
      );
      process.exit(1);
    }
  });

// Parse and run
program.parse();
