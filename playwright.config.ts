// The browser tests (e2e/): the built script on stand-ins of YouTube and of the server, in Chromium as a computer
// (www.youtube.com) and as two phones (m.youtube.com, touch). `npm run e2e`; e2e/README.md.
import { defineConfig, devices } from '@playwright/test';

const phone = (name: 'Pixel 7' | 'iPhone 14') => ({ ...devices[name], defaultBrowserType: 'chromium' as const });

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 45_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel7', use: phone('Pixel 7') },
    { name: 'iphone14', use: phone('iPhone 14') },
  ],
});
