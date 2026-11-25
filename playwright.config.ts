import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "node tests/e2e/backend.mjs", url: "http://127.0.0.1:54329/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "npm run dev -- --port 3100", url: "http://127.0.0.1:3100/auth", reuseExistingServer: false, timeout: 90_000,
      env: { BENCHMARK_TEST_BUILD: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key" } },
  ],
});
