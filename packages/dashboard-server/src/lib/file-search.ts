/**
 * File search utility for the dashboard file picker.
 */

import fs from 'fs';
import path from 'path';
import type { FileSearchResult } from './types.js';

export const FILE_SEARCH_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.turbo',
  '.vercel',
  '.nuxt',
  '.output',
  'vendor',
  'target',
  '.idea',
  '.vscode',
]);

export const FILE_SEARCH_IGNORE_PATTERNS = [
  /\.lock$/,
  /\.log$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.d\.ts$/,
  /\.pyc$/,
];

export async function searchFiles(rootDir: string, query: string, limit: number): Promise<FileSearchResult[]> {
  const results: FileSearchResult[] = [];
  const normalizedQuery = query.trim().toLowerCase();

  const shouldIgnore = (name: string, isDirectory: boolean): boolean => {
    if (isDirectory) {
      return FILE_SEARCH_IGNORE_DIRS.has(name);
    }
    return FILE_SEARCH_IGNORE_PATTERNS.some((pattern) => pattern.test(name));
  };

  const matches = (relativePath: string, name: string): boolean => {
    if (!normalizedQuery) return true;
    const lowerPath = relativePath.toLowerCase();
    const lowerName = name.toLowerCase();

    if (normalizedQuery.includes('/')) {
      return lowerPath.includes(normalizedQuery);
    }

    return lowerName.includes(normalizedQuery) || lowerPath.includes(normalizedQuery);
  };

  const visit = async (dir: string, relativePath = ''): Promise<void> => {
    if (results.length >= limit) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (results.length >= limit) break;
      if (shouldIgnore(entry.name, entry.isDirectory())) continue;

      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (matches(entryPath, entry.name)) {
        results.push({
          path: entryPath,
          name: entry.name,
          isDirectory: entry.isDirectory(),
        });
      }

      if (entry.isDirectory()) {
        await visit(path.join(dir, entry.name), entryPath);
      }
    }
  };

  await visit(rootDir);
  return results;
}
