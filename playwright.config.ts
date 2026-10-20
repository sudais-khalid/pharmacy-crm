import { defineConfig } from "@playwright/test";

/**
 * End-to-end journeys (roadmap 9.6) against a production build on a fresh database. Run them with
 * `node scripts/e2e-local.mjs`, which prepares the database, the server and the worker. The journeys build on
 * each other (the pharmacy created first is used by the rest), so they run in order in one worker.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/e2e",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3200",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1366, height: 860 },
  },
});
