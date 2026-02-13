import Anthropic from '@anthropic-ai/sdk';

export interface ClaudeClientOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export interface GenerateCodeRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export interface ImageContent {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg';
}

export interface GenerateCodeWithImagesRequest {
  systemPrompt: string;
  userPrompt: string;
  images?: ImageContent[];
  temperature?: number;
}

export interface GenerateCodeResponse {
  code: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Wrapper around the Anthropic Claude API for code generation
 */
export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(options: ClaudeClientOptions = {}) {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass apiKey option.'
      );
    }

    this.client = new Anthropic({
      apiKey,
    });

    this.model = options.model || 'claude-sonnet-4-20250514';
    this.maxTokens = options.maxTokens || 8192;
  }

  /**
   * Generate code from a prompt
   */
  async generateCode(request: GenerateCodeRequest): Promise<GenerateCodeResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: request.temperature ?? 0.2,
      system: request.systemPrompt,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });

    // Extract the text content from the response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in response');
    }

    // Extract code from markdown code blocks if present
    let code = textBlock.text;
    const codeBlockMatch = code.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      code = codeBlockMatch[1].trim();
    }

    return {
      code,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Generate code with image context (multi-modal vision)
   * Used for self-healing with screenshots and initial generation with recording screenshots
   */
  async generateCodeWithImages(request: GenerateCodeWithImagesRequest): Promise<GenerateCodeResponse> {
    // Build content blocks: text + images
    const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    // Add images first (so Claude sees them before the prompt)
    if (request.images && request.images.length > 0) {
      for (const img of request.images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.base64,
          },
        });
      }
    }

    // Add text prompt
    content.push({
      type: 'text',
      text: request.userPrompt,
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: request.temperature ?? 0.2,
      system: request.systemPrompt,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in response');
    }

    let code = textBlock.text;
    const codeBlockMatch = code.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      code = codeBlockMatch[1].trim();
    }

    return {
      code,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  /**
   * Generate code with multiple attempts, asking clarifying questions if needed
   */
  async generateCodeWithClarifications(
    request: GenerateCodeRequest,
    maxAttempts: number = 2
  ): Promise<{
    code: string;
    clarifications?: string[];
    usage: { inputTokens: number; outputTokens: number };
  }> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastCode = '';
    const clarifications: string[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.generateCode({
        ...request,
        userPrompt:
          attempt === 0
            ? request.userPrompt
            : `${request.userPrompt}\n\nPrevious clarifications:\n${clarifications.join('\n')}`,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      lastCode = response.code;

      // Check if the response contains clarification questions
      const clarificationMatch = response.code.match(
        /\/\/ CLARIFICATION:\s*(.+?)(?:\n|$)/g
      );
      if (clarificationMatch && clarificationMatch.length > 0) {
        clarifications.push(
          ...clarificationMatch.map((m) => m.replace('// CLARIFICATION:', '').trim())
        );
      } else {
        // No clarifications needed, we're done
        break;
      }
    }

    return {
      code: lastCode,
      clarifications: clarifications.length > 0 ? clarifications : undefined,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    };
  }

  /**
   * Check if the API is accessible and working
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Say "ok" and nothing else.',
          },
        ],
      });

      return response.content.length > 0;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Create a Claude client with default options
 */
export function createClaudeClient(options?: ClaudeClientOptions): ClaudeClient {
  return new ClaudeClient(options);
}
