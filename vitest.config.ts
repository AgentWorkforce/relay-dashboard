import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const __dirname = new URL('.', import.meta.url).pathname;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: [resolve(__dirname, 'test/bugs/global-setup.ts')],
    include: ['test/bugs/**/*.test.ts'],
  },
});
