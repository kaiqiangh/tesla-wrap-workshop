import { defineConfig, devices } from "@playwright/test";

function localNetwork(octet: number) {
  return {
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${octet}` },
  };
}

const webServerCommand =
  process.env.WRAPFORGE_BROWSER_SERVER === "production"
    ? "node scripts/with-local-supabase.mjs pnpm start"
    : "node scripts/with-local-supabase.mjs pnpm dev";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
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
  ],
  webServer: {
    command: webServerCommand,
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 2_000 },
    timeout: 120_000,
  },
});
