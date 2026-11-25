import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // The tests share one database, so run them one file at a time.
    fileParallelism: false,
    pool: 'forks',
  },
});
