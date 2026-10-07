import { defineConfig, devices } from "@playwright/test";
const liveBackend = process.env.CARE_REAL_BACKEND === "1";
export default defineConfig({
  testDir: "tests",
  testMatch: liveBackend ? "host-live.spec.ts" : "host.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 20000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: process.env.CARE_FE_URL ?? "http://localhost:25417",
    // Real authentication must not be persisted in browser artifacts.
    trace: liveBackend ? "off" : "retain-on-failure",
  },
});
