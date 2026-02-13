import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Mock Prisma client to avoid actual database connection
vi.mock('../src/db.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
    $disconnect: vi.fn(),
    recording: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    testSpec: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    testRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    clarification: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    artifact: {
      findMany: vi.fn(),
    },
  },
}));

import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

describe('API Server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Endpoints', () => {
    it('GET /api/health should return ok', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });

    it('GET /api/health/detailed should return service status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health/detailed',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.services).toBeDefined();
      expect(body.services.database).toBeDefined();
    });
  });

  describe('Recordings Endpoints', () => {
    it('POST /api/recordings should validate recording format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/recordings',
        payload: {
          jsonData: { invalid: 'data' },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid recording format');
    });

    it('GET /api/recordings should return list', async () => {
      const { prisma } = await import('../src/db.js');
      vi.mocked(prisma.recording.findMany).mockResolvedValue([]);
      vi.mocked(prisma.recording.count).mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/recordings',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.recordings).toBeDefined();
      expect(Array.isArray(body.recordings)).toBe(true);
    });
  });

  describe('Tests Endpoints', () => {
    it('GET /api/tests should return list', async () => {
      const { prisma } = await import('../src/db.js');
      vi.mocked(prisma.testSpec.findMany).mockResolvedValue([]);
      vi.mocked(prisma.testSpec.count).mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/tests',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tests).toBeDefined();
      expect(Array.isArray(body.tests)).toBe(true);
    });

    it('POST /api/tests/generate should require recordingId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/tests/generate',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Runs Endpoints', () => {
    it('GET /api/runs should return list', async () => {
      const { prisma } = await import('../src/db.js');
      vi.mocked(prisma.testRun.findMany).mockResolvedValue([]);
      vi.mocked(prisma.testRun.count).mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/runs',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.runs).toBeDefined();
      expect(Array.isArray(body.runs)).toBe(true);
    });
  });

  describe('Clarifications Endpoints', () => {
    it('GET /api/clarifications should return list', async () => {
      const { prisma } = await import('../src/db.js');
      vi.mocked(prisma.clarification.findMany).mockResolvedValue([]);
      vi.mocked(prisma.clarification.count).mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/clarifications',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.clarifications).toBeDefined();
      expect(Array.isArray(body.clarifications)).toBe(true);
    });
  });
});
