import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { apiKeyService } from '../services/apikeys.js';

interface CreateKeyBody {
  name: string;
  expiresInDays?: number;
}

interface DeleteKeyParams {
  id: string;
}

export async function apiKeysRoutes(fastify: FastifyInstance) {
  // Create a new API key
  fastify.post<{ Body: CreateKeyBody }>('/', {
    schema: {
      tags: ['api-keys'],
      summary: 'Create a new API key for extension authentication',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Name/description for the key' },
          expiresInDays: { type: 'number', description: 'Days until expiration (optional)' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            key: { type: 'string', description: 'The API key (only shown once)' },
            keyPrefix: { type: 'string' },
            expiresAt: { type: 'string', nullable: true },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: CreateKeyBody }>, reply: FastifyReply) => {
    const { name, expiresInDays } = request.body;

    const result = await apiKeyService.createApiKey(name, expiresInDays);

    return reply.status(201).send({
      id: result.id,
      name: result.name,
      key: result.key,
      keyPrefix: result.keyPrefix,
      expiresAt: result.expiresAt?.toISOString() || null,
      createdAt: result.createdAt.toISOString(),
    });
  });

  // List all API keys
  fastify.get('/', {
    schema: {
      tags: ['api-keys'],
      summary: 'List all API keys',
      response: {
        200: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  keyPrefix: { type: 'string' },
                  lastUsedAt: { type: 'string', nullable: true },
                  createdAt: { type: 'string' },
                  expiresAt: { type: 'string', nullable: true },
                  isExpired: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const keys = await apiKeyService.listApiKeys();

    return {
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        lastUsedAt: k.lastUsedAt?.toISOString() || null,
        createdAt: k.createdAt.toISOString(),
        expiresAt: k.expiresAt?.toISOString() || null,
        isExpired: k.isExpired,
      })),
    };
  });

  // Delete an API key
  fastify.delete<{ Params: DeleteKeyParams }>('/:id', {
    schema: {
      tags: ['api-keys'],
      summary: 'Revoke/delete an API key',
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
          properties: { success: { type: 'boolean' } },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: DeleteKeyParams }>, reply: FastifyReply) => {
    const { id } = request.params;

    const deleted = await apiKeyService.deleteApiKey(id);

    if (!deleted) {
      return reply.status(404).send({ error: 'API key not found' });
    }

    return { success: true };
  });
}
