import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5188,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
