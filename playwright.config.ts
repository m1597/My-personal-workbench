import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 30_000,
  outputDir: 'test-results/production',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/production', open: 'never' }]],
  forbidOnly: Boolean(process.env.CI),
})
