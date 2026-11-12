import { defineConfig } from "@playwright/test"

const backendPort = 18099
const uiPort = 5174
const dataDir = "/tmp/mongoui-e2e-playwright"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    storageState: "e2e/.auth.json",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      // Fresh data directory per run: deterministic auth setup and no stale DB.
      command: `sh -c 'rm -rf ${dataDir} && exec go run . -addr 127.0.0.1:${backendPort} -data ${dataDir}'`,
      cwd: "../backend",
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { MONGOUI_DISABLE_AUTOUPDATE: "1" },
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${uiPort}`,
      url: `http://127.0.0.1:${uiPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_PROXY: `http://127.0.0.1:${backendPort}` },
    },
  ],
})
