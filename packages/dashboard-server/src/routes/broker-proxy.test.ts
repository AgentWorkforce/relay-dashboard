import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../lib/types.js';
import { registerBrokerProxyRoutes } from './broker-proxy.js';

vi.mock('../lib/model-catalog.js', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/model-catalog.js')>(),
  resolveDiscoveryCommand: vi.fn(async () => ({ command: '/portable/opencode', args: [] })),
}));

const catalog = { get: async () => ({
  modelOptions: {
    Claude: [{ value: 'claude-opus-4-6', label: 'Opus 4.6', reasoningEfforts: ['high', 'max'] }],
    Codex: [{ value: 'codex-current', label: 'Codex', reasoningEfforts: ['high', 'ultra'] }],
    Opencode: [{ value: 'provider/current', label: 'Current', reasoningEfforts: ['high', 'custom'] }],
  }, defaultModels: {},
}) };
/** Mount broker routes with a fixed catalog and capture forwarded JSON without a live broker. */
function setup() {
  const app = express();
  app.use(express.json());
  registerBrokerProxyRoutes(app, { brokerProxyEnabled: true, relayUrl: 'http://127.0.0.1:9000' } as RouteContext, catalog);
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  return { app, fetch };
}
afterEach(() => vi.unstubAllGlobals());

describe('selected reasoning effort forwarding', () => {
  it.each([
    ['claude', 'claude-opus-4-6', 'max', ['--effort', 'max']],
    ['codex', 'codex-current', 'ultra', ['-c', 'model_reasoning_effort="ultra"']],
  ])('forwards %s effort as native arguments', async (cli, model, reasoningEffort, args) => {
    const { app, fetch } = setup();
    const response = await request(app).post('/api/spawn').send({ name: 'worker', cli, model, reasoningEffort });
    expect(response.status).toBe(200);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.args).toEqual(args);
    expect(body.model).toBe(model);
    expect(body.reasoningEffort).toBeUndefined();
  });

  it('sets OpenCode effort only in the worker environment, preserving its chosen agent and inline config', async () => {
    const { app, fetch } = setup();
    const response = await request(app).post('/api/spawn').send({
      name: 'worker', cli: 'opencode', model: 'provider/current', args: ['--agent', 'review'], cwd: '/work', reasoningEffort: 'custom',
      harnessConfig: { runtime: 'pty', command: 'opencode', args: [], env: {
        KEEP: 'yes', OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { review: { temperature: 0.1 } }, theme: 'system' }),
      } },
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.harnessConfig.env.KEEP).toBe('yes');
    expect(JSON.parse(body.harnessConfig.env.OPENCODE_CONFIG_CONTENT)).toEqual({
      agent: { review: { temperature: 0.1, model: 'provider/current', variant: 'custom' } }, theme: 'system',
    });
    expect(body.harnessConfig.args).toEqual(['--agent', 'review', '--model', 'provider/current']);
    expect(body.harnessConfig.cwd).toBe('/work');
  });

  it.each(['xhigh', 42, '--dangerously-skip-permissions'])('rejects unsupported effort %s before contacting the broker', async reasoningEffort => {
    const { app, fetch } = setup();
    const response = await request(app).post('/api/spawn').send({ name: 'worker', cli: 'claude', model: 'claude-opus-4-6', reasoningEffort });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves launches without an effort selection unchanged', async () => {
    const { app, fetch } = setup();
    await request(app).post('/api/spawn').send({ name: 'worker', cli: 'codex', model: 'codex-current', args: ['--resume'] });
    expect(JSON.parse(fetch.mock.calls[0][1].body).args).toEqual(['--resume']);
  });

  it.each(['claude', 'codex', 'opencode'])('preserves an explicit %s PTY harness and applies effort to its effective arguments', async cli => {
    const { app, fetch } = setup();
    const model = cli === 'claude' ? 'claude-opus-4-6' : cli === 'codex' ? 'codex-current' : 'provider/current';
    const response = await request(app).post('/api/spawn').send({
      name: 'worker', cli, model, reasoningEffort: 'high',
      harnessConfig: { runtime: 'pty', command: '/custom/launcher', args: ['cli.js', '--agent', 'review', '--session', 'existing'], cwd: '/custom/work' },
    });
    expect(response.status).toBe(200);
    const harness = JSON.parse(fetch.mock.calls[0][1].body).harnessConfig;
    expect(harness.command).toBe('/custom/launcher');
    expect(harness.cwd).toBe('/custom/work');
    expect(harness.args.slice(0, 5)).toEqual(['cli.js', '--agent', 'review', '--session', 'existing']);
    if (cli === 'opencode') expect(JSON.parse(harness.env.OPENCODE_CONFIG_CONTENT).agent.review.variant).toBe('high');
    else expect(harness.args.slice(5)).toEqual(cli === 'claude' ? ['--effort', 'high'] : ['-c', 'model_reasoning_effort="high"']);
  });

  it('resolves the default local OpenCode executable without a shell', async () => {
    const { app, fetch } = setup();
    await request(app).post('/api/spawn').send({ name: 'worker', cli: 'opencode', model: 'provider/current', reasoningEffort: 'high' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).harnessConfig.command).toBe('/portable/opencode');
  });
});
