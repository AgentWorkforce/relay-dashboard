import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerModelsRoutes } from './models.js';

describe('model catalog route', () => {
  it('serves discovered versioned models and provider-specific effort levels', async () => {
    const catalog = { get: vi.fn().mockResolvedValue({
      modelOptions: { Claude: [{ value: 'claude-opus-4-6', label: 'Opus 4.6', reasoningEfforts: ['high', 'max'] }] },
      defaultModels: { claude: 'claude-opus-4-6' },
    }) };
    const app = express();
    registerModelsRoutes(app, catalog);
    const response = await request(app).get('/api/models');
    expect(response.status).toBe(200);
    expect(response.body.modelOptions.Claude).toEqual([
      { value: 'claude-opus-4-6', label: 'Opus 4.6', reasoningEfforts: ['high', 'max'] },
    ]);
    expect(response.body.defaultModels.claude).toBe('claude-opus-4-6');
  });
});
