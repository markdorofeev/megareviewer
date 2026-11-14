import { defineConfig, devices } from "@playwright/test";

const PREVIEW_PORT = 5180;
const VITE_ARGS = "--config web/vite.config.ts --mode design-system";

// The review tests start their own fake-mode server each (see fake-server.ts), so they run in
// parallel without sharing state, and need `pnpm build` first: the server serves dist/web. The
// design-system tests read the preview page, built on its own and served by `vite preview`.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: { trace: "retain-on-failure" },
  // One baseline per platform; fonts render differently on each. Small differences in
  // antialiasing between machines of one platform are let through.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  webServer: {
    command: `pnpm exec vite build ${VITE_ARGS} --logLevel warn && pnpm exec vite preview ${VITE_ARGS} --port ${PREVIEW_PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PREVIEW_PORT}/design-system.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: ["review.spec.ts", "main-page.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        // PLAYWRIGHT_CHANNEL=chrome runs the installed Chrome instead of Playwright's own build.
        ...(process.env.PLAYWRIGHT_CHANNEL && { channel: process.env.PLAYWRIGHT_CHANNEL }),
      },
    },
    {
      name: "design-system",
      testMatch: "design-system.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://localhost:${PREVIEW_PORT}`,
        ...(process.env.PLAYWRIGHT_CHANNEL && { channel: process.env.PLAYWRIGHT_CHANNEL }),
      },
    },
  ],
});
