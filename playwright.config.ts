import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  snapshotDir: './e2e/__snapshots__',
  outputDir: './e2e/__results__',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',

  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 200,
      animations: 'disabled',
    },
  },

  use: {
    baseURL: 'http://localhost:1420',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    ...devices['Desktop Chrome'],
    video: 'off',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
