import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');

describe('Deploy config', () => {
  it('Dockerfile exists and has multi-stage build', () => {
    const path = join(ROOT, 'Dockerfile');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('FROM node:22-alpine AS deps');
    expect(content).toContain('FROM nginx:alpine');
  });

  it('fly.toml has correct app name and region', () => {
    const path = join(ROOT, 'fly.toml');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('app = "relaycast-dashboard"');
    expect(content).toContain('primary_region = "iad"');
  });

  it('nginx.conf has SPA fallback', () => {
    const path = join(ROOT, 'nginx.conf');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('try_files');
    expect(content).toContain('/index.html');
  });

  it('deploy workflow targets correct paths', () => {
    const path = join(ROOT, '../../.github/workflows/deploy-relaycast.yml');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('packages/relaycast/**');
    expect(content).toContain('FLY_API_TOKEN');
  });
});
