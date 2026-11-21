// The manual smoke test on the real YouTube (e2e/live.ts, not in CI): `npm run smoke:live`. Needs a network YouTube
// lets play (not a data centre: there it asks to sign in), e2e/README.md.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /live\.ts$/,
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: { launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }, locale: 'en-US' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel7', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
    { name: 'iphone14', use: { ...devices['iPhone 14'], defaultBrowserType: 'chromium' } },
  ],
});
