import { defineConfig, devices } from "@playwright/test";

const e2eHost = "127.0.0.1";
function readE2ePort() {
  const rawPort = process.env.LANTERNWOOD_E2E_PORT ?? "5175";

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("LANTERNWOOD_E2E_PORT must be a numeric TCP port.");
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("LANTERNWOOD_E2E_PORT must be between 1 and 65535.");
  }

  return String(port);
}

const e2ePort = readE2ePort();
const e2eBaseURL = `http://${e2eHost}:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/__snapshots__/{arg}{ext}",
  use: {
    baseURL: e2eBaseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 820 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 820 },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${e2ePort}`,
    reuseExistingServer: false,
    url: e2eBaseURL,
    timeout: 120_000,
  },
});