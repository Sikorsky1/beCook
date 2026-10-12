import { defineConfig } from "@playwright/test";

// P35: recorridos críticos. Lo lanza scripts/e2e.cjs (npm run test:e2e), que construye la app
// con Supabase local, arranca el OpenAI simulado y los servidores y exporta E2E_BASE_URL.
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error("Run the E2E through `npm run test:e2e` (scripts/e2e.cjs): E2E_BASE_URL is missing.");

const browserUse = {
  baseURL,
  locale: "es-ES",
  timezoneId: "Europe/Madrid",
  // CI uses the runner's Chrome (E2E_CHANNEL=chrome); locally, Playwright's cached Chromium.
  ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  trace: "retain-on-failure" as const,
  screenshot: "only-on-failure" as const,
};

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["github"]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  projects: [
    // Every browser journey at 390 px; the visual ones (tagged @320) also at 320×568.
    { name: "movil-390", testIgnore: /api\.spec\.ts/, use: { ...browserUse, viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "movil-320", testIgnore: /api\.spec\.ts/, grep: /@320/, use: { ...browserUse, viewport: { width: 320, height: 568 }, hasTouch: true } },
    // API contracts with `request`: no browser.
    { name: "api", testMatch: /api\.spec\.ts/, use: { baseURL } },
  ],
});
