import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { createClaudeClient } from '@web3-test/translator';

interface AnalyzeFailureParams {
  specId: string;
}

interface FailureAnalysisResponse {
  diagnosis: string;
  suggestedFix?: string;
  category: 'selector' | 'timeout' | 'network' | 'assertion' | 'unknown';
}

export async function analysisRoutes(fastify: FastifyInstance) {
  // Analyze a test failure with AI
  fastify.post<{ Params: AnalyzeFailureParams }>('/:specId/analyze-failure', {
    schema: {
      tags: ['analysis'],
      summary: 'Analyze a test failure using AI',
      params: {
        type: 'object',
        properties: {
          specId: { type: 'string' },
        },
        required: ['specId'],
      },
    },
  }, async (request: FastifyRequest<{ Params: AnalyzeFailureParams }>, reply: FastifyReply) => {
    const { specId } = request.params;

    // Fetch the spec with its latest failed run
    const spec = await prisma.testSpec.findUnique({
      where: { id: specId },
      include: {
        testRuns: {
          where: { status: 'FAILED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        recording: {
          select: { name: true, dappUrl: true, stepCount: true },
        },
      },
    });

    if (!spec) {
      return reply.status(404).send({ error: 'Test spec not found' });
    }

    const failedRun = spec.testRuns[0];
    if (!failedRun) {
      return reply.status(400).send({ error: 'No failed runs found for this spec' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(500).send({ error: 'AI analysis not configured (missing API key)' });
    }

    const claudeClient = createClaudeClient({ maxTokens: 2048 });

    const systemPrompt = `You are a test failure analyst for dappwright-based Playwright tests that test Web3 dApps with MetaMask wallet integration.

Analyze the failing test and provide:
1. A clear diagnosis of what went wrong
2. A suggested code fix if applicable
3. A category for the failure

Respond in JSON format only (no markdown code blocks):
{
  "diagnosis": "Clear explanation of what went wrong",
  "suggestedFix": "The fixed code snippet or null if no code fix applies",
  "category": "selector|timeout|network|assertion|unknown"
}

Categories:
- selector: Element not found, wrong selector, DOM changed
- timeout: Operation timed out, slow loading, waitFor exceeded
- network: RPC errors, network switching issues, transaction failures
- assertion: Test assertion failed, unexpected value
- unknown: Other/unclear`;

    const userPrompt = `Test: ${spec.recording?.name || 'Unknown'}
dApp URL: ${spec.recording?.dappUrl || 'Unknown'}

Test code:
\`\`\`typescript
${spec.code}
\`\`\`

Error message:
${failedRun.error || 'No error message'}

Logs:
${failedRun.logs || 'No logs available'}

Duration: ${failedRun.durationMs ? `${failedRun.durationMs}ms` : 'Unknown'}`;

    try {
      const response = await claudeClient.generateCode({
        systemPrompt,
        userPrompt,
        temperature: 0.2,
      });

      // The response.code will be the JSON (claude-client strips code blocks)
      let jsonText = response.code;

      // Handle any remaining markdown code blocks
      const jsonMatch = jsonText.match(/```(?:json)?\n?([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      const analysis: FailureAnalysisResponse = JSON.parse(jsonText);

      // Validate category
      const validCategories = ['selector', 'timeout', 'network', 'assertion', 'unknown'];
      if (!validCategories.includes(analysis.category)) {
        analysis.category = 'unknown';
      }

      return {
        diagnosis: analysis.diagnosis,
        suggestedFix: analysis.suggestedFix || null,
        category: analysis.category,
        runId: failedRun.id,
        error: failedRun.error,
      };
    } catch (error) {
      fastify.log.error(error, 'AI failure analysis error');
      return reply.status(500).send({
        error: 'Failed to analyze test failure',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
