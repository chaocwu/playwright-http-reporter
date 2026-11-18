# @chaocw/playwright-http-reporter

[![npm version](https://img.shields.io/npm/v/@chaocw/playwright-http-reporter.svg)](https://www.npmjs.com/package/@chaocw/playwright-http-reporter)
[![CI](https://github.com/chaocwu/playwright-http-reporter/actions/workflows/ci.yml/badge.svg)](https://github.com/chaocwu/playwright-http-reporter/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@chaocw/playwright-http-reporter.svg)](./LICENSE)

A Playwright reporter that sends the complete test run to an HTTP endpoint as a single JSON report when the run ends.

- One atomic `POST` per run: easy to store, index, and display.
- Full report: run metadata, CI context, summary, tests, retries, steps, errors, attachments, stdout/stderr.
- Reliable delivery: timeouts, exponential backoff, `Retry-After`, fallback file for undelivered reports.
- Safe by default: failures do not fail your test run, attachments and output are opt-in, no environment dump.
- ESM and CommonJS builds, zero runtime dependencies, TypeScript types included.

## Requirements

- Node.js 18 or newer
- `@playwright/test` 1.40 or newer

## Installation

```bash
npm install --save-dev @chaocw/playwright-http-reporter
```

## Quick start

Register the reporter in `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    [
      "@chaocw/playwright-http-reporter",
      {
        endpoint: "https://ci.example.com/api/playwright",
        token: process.env.REPORT_TOKEN,
      },
    ],
  ],
});
```

Or use a local reporter path during development:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    ["./path/to/reporter.ts", { endpoint: "https://ci.example.com/api/playwright" }],
  ],
});
```

The package also exports the `HttpReporter` class if you need to instantiate it programmatically.

The reporter sends a `POST` request with `Content-Type: application/json`, an `X-Playwright-Run-Id` header, and `Authorization: Bearer <token>` when `token` is set.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | required | HTTP(S) URL that receives the report. |
| `method` | `"POST" \| "PUT" \| "PATCH"` | `"POST"` | Upload method. |
| `token` | `string` | – | Adds `Authorization: Bearer <token>` unless an authorization header is already provided. |
| `headers` | `Record<string, string>` | `{}` | Extra request headers. |
| `timeout` | `number` | `15000` | Per-request timeout in milliseconds. |
| `retries` | `number` | `2` | Retry attempts after the first request fails. |
| `retryDelay` | `number` | `500` | Base delay for exponential backoff in milliseconds. |
| `onlyOnFailure` | `boolean` | `false` | Upload only when the run has unexpected failures, flaky tests, or runner errors. |
| `failOnError` | `boolean` | `false` | Throw from `onEnd` when the upload fails. |
| `includeAttachments` | `boolean` | `false` | Inline attachment bodies as base64. Metadata is always included. |
| `maxAttachmentSize` | `number` | `1048576` | Maximum attachment size in bytes to inline. Larger attachments get `omitted: "too-large"`. `0` disables the limit. |
| `includeStdout` | `boolean` | `false` | Include test stdout and stderr. |
| `includeSteps` | `boolean` | `true` | Include the step tree for every attempt. |
| `maxErrorLength` | `number` | `65536` | Maximum characters per message/stack/snippet. `0` disables truncation. |
| `maxOutputLength` | `number` | `32768` | Maximum characters of stdout/stderr per attempt. `0` disables truncation. |
| `metadata` | `Record<string, unknown>` | – | Custom metadata attached to `run.metadata`. |
| `transformPayload` | `(payload) => payload \| Promise<payload>` | – | Redact or mutate the report before upload. |
| `fallbackDir` | `string` | `./test-results` | Directory for undelivered reports. |
| `verbose` | `boolean` | `false` | Log progress to stderr. |
| `gzip` | `boolean` | `false` | Gzip the request body and send `Content-Encoding: gzip`. |
| `fetch` | `typeof fetch` | global fetch | Custom fetch implementation. |

Accepted requests are any `2xx` response. Network errors and `408`, `425`, `429`, and `5xx` responses are retried. Other `4xx` responses fail immediately.

## Report format

```jsonc
{
  "schemaVersion": 1,
  "run": {
    "id": "0f8d…",
    "startedAt": "2026-01-01T00:00:00.000Z",
    "finishedAt": "2026-01-01T00:01:02.000Z",
    "duration": 62000,
    "status": "failed",
    "playwrightVersion": "1.65.0",
    "reporter": { "name": "@chaocw/playwright-http-reporter", "version": "0.1.0" },
    "runtime": { "node": "v24.0.0", "platform": "linux", "arch": "x64" },
    "config": {
      "rootDir": "/repo",
      "workers": 4,
      "projects": [{ "name": "chromium", "retries": 2 }]
    },
    "ci": { "isCI": true, "provider": "github", "commit": "abc123" },
    "metadata": { "environment": "staging" }
  },
  "summary": {
    "total": 3,
    "expected": 2,
    "unexpected": 1,
    "flaky": 0,
    "skipped": 0,
    "passed": 2,
    "failed": 1,
    "timedOut": 0,
    "interrupted": 0
  },
  "tests": [
    {
      "id": "…",
      "title": "checkout works",
      "titlePath": ["", "checkout.spec.ts", "checkout works"],
      "file": "tests/checkout.spec.ts",
      "line": 12,
      "column": 1,
      "projectName": "chromium",
      "tags": ["@smoke"],
      "annotations": [],
      "expectedStatus": "passed",
      "outcome": "unexpected",
      "status": "failed",
      "repeatEachIndex": 0,
      "attempts": [
        {
          "retry": 0,
          "status": "failed",
          "duration": 1200,
          "startTime": "2026-01-01T00:00:10.000Z",
          "workerIndex": 1,
          "parallelIndex": 1,
          "errors": [{ "message": "expected 1 to be 2", "stack": "…" }],
          "steps": [],
          "attachments": [{ "name": "screenshot", "contentType": "image/png", "path": "…" }]
        }
      ]
    }
  ],
  "errors": []
}
```

The JSON Schema is published at `@chaocw/playwright-http-reporter/schema/report.schema.json`.

### Field notes

- `run.status` is Playwright's `FullResult` status: `passed`, `failed`, `timedout`, or `interrupted`.
- Each test has an `attempts` array, so retries and their errors are preserved.
- `outcome` is Playwright's test outcome: `expected`, `unexpected`, `flaky`, or `skipped`.
- `status` on a test is the status of its last attempt.
- Attachments include `path`, `size`, and `omitted` metadata. Bodies require `includeAttachments`.
- CI metadata comes from well-known environment variables. Only allow-listed fields are sent; the full environment is never included.

## Receiving the report

The `example/server.mjs` file contains a zero-dependency receiver:

```bash
node example/server.mjs
```

```js
import { createServer } from "node:http";

createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  console.log(report.run.id, report.summary);
  response.writeHead(204).end();
}).listen(8787);
```

If `gzip: true` is enabled, decompress the request body when `content-encoding` is `gzip`.

## Failure handling

By default, an upload failure is logged to stderr but does not fail the test run. The reporter writes the undelivered payload to:

```
test-results/playwright-http-reporter-<runId>.json
```

The file contains `runId`, `endpoint`, `error`, `attempts`, and the full `payload`. You can replay it:

```bash
jq '.payload' test-results/playwright-http-reporter-*.json \
  | curl -X POST "https://ci.example.com/api/playwright" \
      -H "Content-Type: application/json" \
      --data-binary @-
```

Set `failOnError: true` if the CI job must fail when the report cannot be delivered.

## Redaction

Use `transformPayload` to remove secrets or reshape the report before it leaves the machine:

```ts
import HttpReporter from "@chaocw/playwright-http-reporter";

new HttpReporter({
  endpoint: "https://ci.example.com/api/playwright",
  transformPayload(payload) {
    for (const test of payload.tests) {
      delete test.attempts[0]?.stdout;
    }
    return payload;
  },
});
```

## Security considerations

- Prefer HTTPS endpoints and read tokens from environment variables. Do not commit tokens.
- The report contains test titles, file paths, errors, and CI metadata. Enable `includeStdout` and `includeAttachments` only when your endpoint is trusted.
- `headers` are sent verbatim. Avoid putting secrets in URLs because they may appear in logs and proxy histories.
- Set `maxAttachmentSize` conservatively to keep requests small.

## ESM and CommonJS

The package ships both formats and TypeScript declarations:

```ts
import HttpReporter from "@chaocw/playwright-http-reporter"; // ESM
```

```js
const { HttpReporter } = require("@chaocw/playwright-http-reporter"); // CommonJS
```

Public types include `HttpReporterOptions`, `ReportPayload`, `ReportRun`, `ReportTest`, `ReportAttempt`, and others.

## Development

```bash
bun install
npm run typecheck
npm test
npm run build
npm run smoke:pack
```

Run the example locally:

```bash
npm run build
node example/server.mjs
npx playwright test -c example/playwright.config.ts
```

The example intentionally contains one failing test, so the Playwright command exits with a non-zero status while the report server prints the received summary.

## Releasing

Releases are published from GitHub Actions using npm Trusted Publishing (OIDC):

```bash
npm version patch
git push origin main --tags
```

The `release.yml` workflow verifies the tag, runs type checks and tests, builds the package, and runs `npm publish --access public`. Provenance is generated automatically for the public package.

## License

MIT
