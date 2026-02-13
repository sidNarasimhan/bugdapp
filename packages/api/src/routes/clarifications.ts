import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';

// Request/Response types
interface GetClarificationParams {
  id: string;
}

interface AnswerClarificationBody {
  answer: string;
}

interface ListClarificationsQuery {
  testSpecId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function clarificationsRoutes(fastify: FastifyInstance) {
  // Get a clarification by ID
  fastify.get<{ Params: GetClarificationParams }>('/:id', {
    schema: {
      tags: ['clarifications'],
      summary: 'Get a clarification question by ID',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            testSpecId: { type: 'string' },
            type: { type: 'string' },
            question: { type: 'string' },
            context: { type: 'string', nullable: true },
            stepIndex: { type: 'number', nullable: true },
            options: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string', nullable: true },
            status: { type: 'string' },
            createdAt: { type: 'string' },
            answeredAt: { type: 'string', nullable: true },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetClarificationParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const clarification = await prisma.clarification.findUnique({
      where: { id },
    });

    if (!clarification) {
      return reply.status(404).send({ error: 'Clarification not found' });
    }

    return {
      id: clarification.id,
      testSpecId: clarification.testSpecId,
      type: clarification.type,
      question: clarification.question,
      context: clarification.context,
      stepIndex: clarification.stepIndex,
      options: clarification.options,
      answer: clarification.answer,
      status: clarification.status,
      createdAt: clarification.createdAt.toISOString(),
      answeredAt: clarification.answeredAt?.toISOString() || null,
    };
  });

  // Answer a clarification
  fastify.post<{ Params: GetClarificationParams; Body: AnswerClarificationBody }>('/:id/answer', {
    schema: {
      tags: ['clarifications'],
      summary: 'Answer a clarification question',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['answer'],
        properties: {
          answer: { type: 'string', description: 'The answer to the clarification question' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            answer: { type: 'string' },
            answeredAt: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetClarificationParams; Body: AnswerClarificationBody }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { answer } = request.body;

    const clarification = await prisma.clarification.findUnique({
      where: { id },
    });

    if (!clarification) {
      return reply.status(404).send({ error: 'Clarification not found' });
    }

    if (clarification.status !== 'PENDING') {
      return reply.status(400).send({
        error: `Clarification already ${clarification.status.toLowerCase()}`,
      });
    }

    // Update the clarification
    const updated = await prisma.clarification.update({
      where: { id },
      data: {
        answer,
        status: 'ANSWERED',
        answeredAt: new Date(),
      },
    });

    // Check if all clarifications for the test spec are answered
    const pendingCount = await prisma.clarification.count({
      where: {
        testSpecId: clarification.testSpecId,
        status: 'PENDING',
      },
    });

    // If all answered, update test spec status to READY
    if (pendingCount === 0) {
      await prisma.testSpec.update({
        where: { id: clarification.testSpecId },
        data: { status: 'READY' },
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      answer: updated.answer,
      answeredAt: updated.answeredAt?.toISOString(),
    };
  });

  // Skip a clarification
  fastify.post<{ Params: GetClarificationParams }>('/:id/skip', {
    schema: {
      tags: ['clarifications'],
      summary: 'Skip a clarification question',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: GetClarificationParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const clarification = await prisma.clarification.findUnique({
      where: { id },
    });

    if (!clarification) {
      return reply.status(404).send({ error: 'Clarification not found' });
    }

    if (clarification.status !== 'PENDING') {
      return reply.status(400).send({
        error: `Clarification already ${clarification.status.toLowerCase()}`,
      });
    }

    const updated = await prisma.clarification.update({
      where: { id },
      data: {
        status: 'SKIPPED',
      },
    });

    // Check if all clarifications are handled
    const pendingCount = await prisma.clarification.count({
      where: {
        testSpecId: clarification.testSpecId,
        status: 'PENDING',
      },
    });

    if (pendingCount === 0) {
      await prisma.testSpec.update({
        where: { id: clarification.testSpecId },
        data: { status: 'READY' },
      });
    }

    return {
      id: updated.id,
      status: updated.status,
    };
  });

  // List clarifications
  fastify.get<{ Querystring: ListClarificationsQuery }>('/', {
    schema: {
      tags: ['clarifications'],
      summary: 'List clarification questions',
      querystring: {
        type: 'object',
        properties: {
          testSpecId: { type: 'string', description: 'Filter by test spec ID' },
          status: { type: 'string', description: 'Filter by status (PENDING, ANSWERED, SKIPPED)' },
          limit: { type: 'number', default: 20, maximum: 100 },
          offset: { type: 'number', default: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            clarifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  testSpecId: { type: 'string' },
                  type: { type: 'string' },
                  question: { type: 'string' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Querystring: ListClarificationsQuery }>) => {
    const { testSpecId, status, limit = 20, offset = 0 } = request.query;

    const where: Record<string, unknown> = {};
    if (testSpecId) where.testSpecId = testSpecId;
    if (status) where.status = status;

    const [clarifications, total] = await Promise.all([
      prisma.clarification.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          testSpecId: true,
          type: true,
          question: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.clarification.count({ where }),
    ]);

    return {
      clarifications: clarifications.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  });
}
