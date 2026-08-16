import { defineConfig, devices } from "@playwright/test";

function localNetwork(octet: number) {
  return {
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${octet}` },
  };
}

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...localNetwork(10) },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], ...localNetwork(11) },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], ...localNetwork(12) },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], ...localNetwork(13) },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"], ...localNetwork(14) },
    },
    {
      name: "viewport-360",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 640 },
        ...localNetwork(15),
      },
    },
    {
      name: "reflow-320",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 800 },
        ...localNetwork(16),
      },
    },
    {
      name: "mobile-landscape",
      use: { ...devices["Pixel 7 landscape"], ...localNetwork(17) },
    },
    {
      name: "tablet-portrait",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        ...localNetwork(18),
      },
    },
    {
      name: "tablet-landscape",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
        ...localNetwork(19),
      },
    },
    {
      name: "desktop-1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...localNetwork(20),
      },
    },
  ],
  webServer: {
    command: "node scripts/with-local-supabase.mjs pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 2_000 },
    timeout: 120_000,
  },
});
