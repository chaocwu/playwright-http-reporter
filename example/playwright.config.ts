import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

// The example uses the built output directly so it can run inside this repository.
const reporterPath = fileURLToPath(new URL("../dist/esm/index.js", import.meta.url));

export default defineConfig({
  testDir: "./tests",
  reporter: [
    ["list"],
    [
      reporterPath,
      {
        endpoint: process.env.REPORT_ENDPOINT ?? "http://127.0.0.1:8787/report",
        metadata: { example: true },
        verbose: true,
      },
    ],
  ],
});
