import { defineConfig } from '@playwright/test'
import config from './playwright.config'

process.env.WORKBENCH_TEST_RENDERER_URL = 'http://127.0.0.1:5174'

export default defineConfig({
  ...config,
  outputDir: 'test-results/development',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/development', open: 'never' }]],
  webServer: {
    command: 'npm run dev:web -- --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
  },
})
