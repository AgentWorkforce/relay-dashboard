import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { searchFiles, FILE_SEARCH_IGNORE_DIRS, FILE_SEARCH_IGNORE_PATTERNS } from './file-search.js';

describe('searchFiles', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-search-test-'));
    // Create test structure
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), '');
    fs.writeFileSync(path.join(tmpDir, 'data.min.js'), '');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds files matching query by name', async () => {
    const results = await searchFiles(tmpDir, 'index', 50);
    expect(results.some((r) => r.name === 'index.ts')).toBe(true);
  });

  it('respects ignore dirs (node_modules)', async () => {
    const results = await searchFiles(tmpDir, '', 100);
    const inNodeModules = results.filter((r) => r.path.includes('node_modules'));
    expect(inNodeModules).toHaveLength(0);
  });

  it('respects ignore patterns (.min.js)', async () => {
    const results = await searchFiles(tmpDir, '', 100);
    const minFiles = results.filter((r) => r.name.endsWith('.min.js'));
    expect(minFiles).toHaveLength(0);
  });

  it('respects limit', async () => {
    const results = await searchFiles(tmpDir, '', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns all matches for empty query', async () => {
    const results = await searchFiles(tmpDir, '', 100);
    expect(results.length).toBeGreaterThan(0);
  });

  it('matches path segments when query contains /', async () => {
    const results = await searchFiles(tmpDir, 'src/utils', 50);
    expect(results.some((r) => r.name === 'utils.ts')).toBe(true);
  });
});

describe('FILE_SEARCH_IGNORE_DIRS', () => {
  it('contains common ignored directories', () => {
    expect(FILE_SEARCH_IGNORE_DIRS.has('node_modules')).toBe(true);
    expect(FILE_SEARCH_IGNORE_DIRS.has('.git')).toBe(true);
    expect(FILE_SEARCH_IGNORE_DIRS.has('dist')).toBe(true);
  });
});

describe('FILE_SEARCH_IGNORE_PATTERNS', () => {
  it('matches .lock files', () => {
    expect(FILE_SEARCH_IGNORE_PATTERNS.some((p) => p.test('package.json'))).toBe(false);
    expect(FILE_SEARCH_IGNORE_PATTERNS.some((p) => p.test('yarn.lock'))).toBe(true);
  });

  it('matches .d.ts files', () => {
    expect(FILE_SEARCH_IGNORE_PATTERNS.some((p) => p.test('types.d.ts'))).toBe(true);
  });
});
