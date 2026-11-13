import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    allowedHosts: ['host.docker.internal'],
    port: 5186,
    watch: { ignored: ['**/coverage/**', '**/test-results/**'] },
    proxy: { '/api': process.env.OKNO_API_TARGET ?? 'http://127.0.0.1:3100' },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts?(x)'],
    coverage: { include: ['src/**/*.{ts,tsx}'] },
  },
});
