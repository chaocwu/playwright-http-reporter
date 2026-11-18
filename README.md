# @chaocw/playwright-http-reporter

Playwright reporter that POSTs test events to an HTTP endpoint while the run is in progress. Each request carries Playwright's own objects; there is no custom report schema and no aggregation.

## Install

```bash
npm install --save-dev @chaocw/playwright-http-reporter
```

Requires Node.js 18+ and `@playwright/test` 1.42+.

## Configure

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    [
      "@chaocw/playwright-http-reporter",
      {
        endpoint: "https://ci.example.com/playwright",
        token: process.env.REPORT_TOKEN,
      },
    ],
  ],
});
```

## Requests

One `POST` per reporter event:

```jsonc
{
  "runId": "5f0c…", // same for every event of a run
  "seq": 3, // 0-based position of the event in the run
  "event": "testEnd", // begin | testEnd | error | end
  "timestamp": "2026-11-18T05:00:00.000Z",
  "data": {
    "test": {
      "id": "abc",
      "title": "checkout works",
      "titlePath": ["", "checkout.spec.ts", "checkout works"],
      "location": { "file": "tests/checkout.spec.ts", "line": 12, "column": 1 },
      "projectName": "chromium",
      "tags": ["@smoke"],
      "annotations": [],
      "expectedStatus": "passed",
      "outcome": "unexpected",
      "repeatEachIndex": 0,
    },
    "result": {
      "retry": 0,
      "status": "failed",
      "duration": 1200,
      "errors": [],
      "steps": [],
      "...": "…",
    },
  },
}
```

| `event`   | `data`                                                          |
| --------- | --------------------------------------------------------------- |
| `begin`   | `{ totalTests }`                                                |
| `testEnd` | `{ test, result }`, where `result` is Playwright's `TestResult` |
| `error`   | Playwright's `TestError`                                        |
| `end`     | Playwright's `FullResult`                                       |

`result` is forwarded as Playwright provides it: retries, errors, steps, attachments, stdout and stderr are untouched. Serialization omits functions and replaces circular references (for example `step.parent`) with `"[Circular]"`.

`runId` and `seq` identify an event. Retries can deliver the same event twice, so deduplicate on that pair.

Requests use `Content-Type: application/json`, `Accept: application/json`, `User-Agent: @chaocw/playwright-http-reporter`, and `Authorization: Bearer <token>` when `token` is set.

## Options

| Option     | Type                     | Default  | Description                                                        |
| ---------- | ------------------------ | -------- | ------------------------------------------------------------------ |
| `endpoint` | `string`                 | required | URL that receives the requests.                                    |
| `token`    | `string`                 | –        | Bearer token; ignored when `headers` already sets `authorization`. |
| `headers`  | `Record<string, string>` | `{}`     | Extra request headers.                                             |
| `timeout`  | `number`                 | `10000`  | Per-request timeout in milliseconds.                               |
| `retries`  | `number`                 | `2`      | Retries after the first failed request.                            |
| `verbose`  | `boolean`                | `false`  | Log each upload to stderr.                                         |

Events are sent in order. `onEnd` waits for the queue, so the process does not exit before pending requests finish. Network errors, `408`, `429` and `5xx` are retried with exponential backoff; other responses are not. A failed upload is logged to stderr and does not fail the test run.

## Receive

`example/server.mjs` is a zero-dependency receiver:

```bash
node example/server.mjs
```

## Public API

```ts
import HttpReporter, {
  type HttpReporterOptions,
} from "@chaocw/playwright-http-reporter";
```

The default export and the named `HttpReporter` are the same class. The package ships ESM, CommonJS and TypeScript declarations.

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build
bun run smoke:pack
```

End-to-end example (run from the repository root):

```bash
bun run build
node example/server.mjs
bunx playwright test -c example/playwright.config.ts
```

## License

MIT
