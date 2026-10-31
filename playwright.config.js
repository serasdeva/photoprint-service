const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 4173);
const baseURL = `http://127.0.0.1:${PORT}`;
// В CI ставится Chromium, привязанный к версии Playwright. Локально, если браузер
// ещё не скачан, можно указать E2E_CHANNEL=chrome или E2E_CHANNEL=msedge.
const channel = process.env.E2E_CHANNEL;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  // Один сервер и одна временная БД на прогон: параллельные воркеры делили бы данные.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    ...(channel ? { channel } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
