/**
 * Health Routes Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.js';
import type { ServerContext } from '../types/index.js';

describe('Health Routes', () => {
  let app: Express;
  let context: ServerContext;

  beforeEach(() => {
    app = express();
    context = {
      dataDir: '/tmp/test-data',
      teamDir: '/tmp/test-team',
    };
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const router = createHealthRouter({ context, mode: 'full' });
      app.use(router);

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('relay-dashboard');
      expect(res.body.mode).toBe('full');
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body.timestamp).toBeDefined();
    });

    it('reflects the server mode', async () => {
      const router = createHealthRouter({ context, mode: 'mock' });
      app.use(router);

      const res = await request(app).get('/health');

      expect(res.body.mode).toBe('mock');
    });
  });

  describe('GET /api/health', () => {
    it('returns detailed health with stats', async () => {
      const router = createHealthRouter({
        context,
        mode: 'full',
        getAgentCount: () => 5,
        getMessageCount: () => 100,
      });
      app.use(router);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.stats.agents).toBe(5);
      expect(res.body.stats.messages).toBe(100);
      expect(res.body.memory).toBeDefined();
      expect(res.body.memory.heapUsed).toBeGreaterThan(0);
    });

    it('handles missing stat functions gracefully', async () => {
      const router = createHealthRouter({ context, mode: 'proxy' });
      app.use(router);

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.stats.agents).toBe(0);
      expect(res.body.stats.messages).toBe(0);
    });
  });

  describe('GET /keep-alive', () => {
    it('returns ok', async () => {
      const router = createHealthRouter({ context, mode: 'full' });
      app.use(router);

      const res = await request(app).get('/keep-alive');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});
