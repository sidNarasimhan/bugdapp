import type { AgentUsage } from './types.js';

// Pricing per million tokens (as of 2025)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
};

/**
 * Tracks API usage and estimates cost for an agent run.
 */
export class CostTracker {
  private model: string;
  private calls: number = 0;
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private cacheReadTokens: number = 0;
  private cacheCreationTokens: number = 0;

  constructor(model: string) {
    this.model = model;
  }

  /**
   * Record usage from an API response.
   */
  recordUsage(usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }): void {
    this.calls++;
    this.inputTokens += usage.input_tokens || 0;
    this.outputTokens += usage.output_tokens || 0;
    this.cacheReadTokens += usage.cache_read_input_tokens || 0;
    this.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
  }

  /**
   * Estimate cost in USD.
   */
  estimateCost(): number {
    const pricing = PRICING[this.model] || PRICING['claude-sonnet-4-5-20250929'];

    const inputCost = (this.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (this.outputTokens / 1_000_000) * pricing.output;
    const cacheReadCost = (this.cacheReadTokens / 1_000_000) * pricing.cacheRead;
    const cacheWriteCost = (this.cacheCreationTokens / 1_000_000) * pricing.cacheWrite;

    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  /**
   * Get the full usage summary.
   */
  getUsage(): AgentUsage {
    return {
      totalApiCalls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheCreationTokens: this.cacheCreationTokens,
      estimatedCostUsd: this.estimateCost(),
    };
  }

  /**
   * Get a human-readable summary.
   */
  toString(): string {
    const usage = this.getUsage();
    return `${usage.totalApiCalls} API calls, ${usage.inputTokens + usage.outputTokens} tokens, ~$${usage.estimatedCostUsd.toFixed(3)}`;
  }
}
