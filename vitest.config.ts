import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10_000,
    env: { NODE_ENV: 'test' },
  },
});
