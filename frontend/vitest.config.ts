import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Node 25+ ships a global localStorage that shadows jsdom's (and is
    // undefined without --localstorage-file), breaking every storage test.
    execArgv:
      Number(process.versions.node.split('.')[0]) >= 25 ? ['--no-experimental-webstorage'] : [],
  },
});
