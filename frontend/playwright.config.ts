import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: process.env.E2E_COVERAGE === 'true' ? [['list'], ['./e2e/coverage.mjs']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5187',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH },
  },
  projects: [
    { name: 'desktop', grepInvert: /@mobile/, use: devices['Desktop Chrome'] },
    { name: 'mobile', grep: /@mobile/, use: devices['Pixel 7'] },
  ],
});
