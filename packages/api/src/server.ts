import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';

import { recordingsRoutes } from './routes/recordings.js';
import { testsRoutes } from './routes/tests.js';
import { runsRoutes } from './routes/runs.js';
import { clarificationsRoutes } from './routes/clarifications.js';
import { healthRoutes } from './routes/health.js';
import { streamingRoutes } from './routes/streaming.js';
import { apiKeysRoutes } from './routes/apikeys.js';
import { artifactsRoutes } from './routes/artifacts.js';
import { projectsRoutes, suiteRunsRoutes } from './routes/projects.js';
import { analysisRoutes } from './routes/analysis.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
    bodyLimit: 10 * 1024 * 1024, // 10 MiB (default 1 MiB too small for large recordings)
  });

  // Register plugins
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(sensible);

  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max file size
    },
  });

  // WebSocket support for VNC streaming
  await fastify.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB max message size
    },
  });

  // Swagger documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Web3 dApp Testing Platform API',
        description: 'API for uploading recordings, generating tests, and running executions',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${PORT}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'recordings', description: 'Recording upload and management' },
        { name: 'tests', description: 'Test spec generation and management' },
        { name: 'runs', description: 'Test execution and results' },
        { name: 'clarifications', description: 'Clarification Q&A' },
        { name: 'health', description: 'Health checks' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Register routes
  await fastify.register(healthRoutes, { prefix: '/api' });
  await fastify.register(recordingsRoutes, { prefix: '/api/recordings' });
  await fastify.register(testsRoutes, { prefix: '/api/tests' });
  await fastify.register(runsRoutes, { prefix: '/api/runs' });
  await fastify.register(clarificationsRoutes, { prefix: '/api/clarifications' });
  await fastify.register(streamingRoutes, { prefix: '/api' });
  await fastify.register(apiKeysRoutes, { prefix: '/api/api-keys' });
  await fastify.register(artifactsRoutes, { prefix: '/api/artifacts' });
  await fastify.register(projectsRoutes, { prefix: '/api/projects' });
  await fastify.register(suiteRunsRoutes, { prefix: '/api/suite-runs' });
  await fastify.register(analysisRoutes, { prefix: '/api/analysis' });

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();

    await server.listen({ port: PORT, host: HOST });

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              Web3 dApp Testing Platform API                      ║
╠══════════════════════════════════════════════════════════════════╣
║  Server running at: http://${HOST}:${PORT}                         ║
║  API Documentation: http://${HOST}:${PORT}/docs                    ║
╚══════════════════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Export for testing
export { buildServer };

// Start server if run directly
start();
