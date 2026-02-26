import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: [resolve(__dirname, 'global-setup.ts')],
    include: ['test/bugs/**/*.test.ts'],
  },
});
