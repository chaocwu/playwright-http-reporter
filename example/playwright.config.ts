import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

// Runs the built reporter directly so the example works inside this repository.
const reporterPath = resolve("dist/index.cjs");

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.ts",
  reporter: [
    ["list"],
    [
      reporterPath,
      {
        endpoint: process.env.REPORT_ENDPOINT ?? "http://127.0.0.1:8787/report",
        verbose: true,
      },
    ],
  ],
});
