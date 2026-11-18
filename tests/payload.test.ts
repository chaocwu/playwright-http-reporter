import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildReport,
  type ReportLimits,
  type ReportPayload,
} from "../src/payload.js";
import {
  makeAttachment,
  makeConfig,
  makeError,
  makeFullResult,
  makeResult,
  makeStep,
  makeSuite,
  makeTest,
} from "./helpers.js";

const baseLimits: ReportLimits = {
  includeAttachments: false,
  maxAttachmentSize: 1_048_576,
  includeStdout: false,
  includeSteps: true,
  maxErrorLength: 65_536,
  maxOutputLength: 32_768,
};

async function build(
  tests: ReturnType<typeof makeTest>[],
  limits: Partial<ReportLimits> = {},
  errors = [] as ReturnType<typeof makeError>[],
): Promise<ReportPayload> {
  return buildReport({
    runId: "run-123",
    config: makeConfig(),
    suite: makeSuite(tests),
    result: makeFullResult(),
    errors,
    metadata: { env: "staging" },
    limits: { ...baseLimits, ...limits },
  });
}

describe("buildReport", () => {
  let tempDirectory: string;

  beforeAll(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), "pw-http-reporter-payload-"));
  });

  afterAll(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it("maps run metadata, config, tests and summary", async () => {
    const passing = makeTest({
      id: "passing",
      title: "passes",
      tags: ["@smoke"],
      annotations: [{ type: "issue", description: "#42" }],
      results: [
        makeResult({
          status: "passed",
          duration: 25,
          steps: [makeStep({ title: "open page", steps: [makeStep({ title: "click" })] })],
        }),
      ],
    });
    const flaky = makeTest({
      id: "flaky",
      title: "flakes",
      outcome: "flaky",
      results: [
        makeResult({ retry: 0, status: "failed", errors: [makeError("first attempt failed")] }),
        makeResult({ retry: 1, status: "passed" }),
      ],
    });
    const skipped = makeTest({
      id: "skipped",
      title: "skipped",
      outcome: "skipped",
      expectedStatus: "skipped",
      results: [],
    });
    const unexpected = makeTest({
      id: "failed",
      title: "fails",
      outcome: "unexpected",
      results: [
        makeResult({
          status: "failed",
          errors: [makeError("expected 1 to be 2")],
        }),
      ],
    });

    const payload = await build([passing, flaky, skipped, unexpected]);

    expect(payload.schemaVersion).toBe(1);
    expect(payload.run.id).toBe("run-123");
    expect(payload.run.status).toBe("passed");
    expect(payload.run.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.run.finishedAt).toBe("2026-01-01T00:00:01.234Z");
    expect(payload.run.duration).toBe(1_234);
    expect(payload.run.playwrightVersion).toBe("1.65.0");
    expect(payload.run.reporter.name).toBe("@chaocw/playwright-http-reporter");
    expect(payload.run.reporter.version).toBe("0.1.0");
    expect(payload.run.runtime.node).toBe(process.version);
    expect(payload.run.config.rootDir).toBe("/repo");
    expect(payload.run.config.workers).toBe(4);
    expect(payload.run.config.projects[0]).toMatchObject({ name: "chromium", retries: 2 });
    expect(payload.run.metadata).toEqual({ env: "staging" });
    expect(typeof payload.run.ci.isCI).toBe("boolean");

    expect(payload.summary).toEqual({
      total: 4,
      expected: 1,
      unexpected: 1,
      flaky: 1,
      skipped: 1,
      passed: 2,
      failed: 1,
      timedOut: 0,
      interrupted: 0,
    });

    expect(payload.tests.map((test) => test.id)).toEqual(["passing", "flaky", "skipped", "failed"]);

    const passingReport = payload.tests[0]!;
    expect(passingReport).toMatchObject({
      title: "passes",
      file: "tests/example.spec.ts",
      line: 3,
      column: 1,
      projectName: "chromium",
      tags: ["@smoke"],
      annotations: [{ type: "issue", description: "#42" }],
      expectedStatus: "passed",
      outcome: "expected",
      status: "passed",
      repeatEachIndex: 0,
    });
    expect(passingReport.attempts[0]!.steps?.[0]).toMatchObject({
      title: "open page",
      category: "test.step",
      steps: [{ title: "click" }],
    });

    const flakyReport = payload.tests[1]!;
    expect(flakyReport.outcome).toBe("flaky");
    expect(flakyReport.attempts).toHaveLength(2);
    expect(flakyReport.attempts[0]).toMatchObject({ retry: 0, status: "failed" });
    expect(flakyReport.attempts[0]!.errors[0]!.message).toBe("first attempt failed");
    expect(flakyReport.attempts[1]).toMatchObject({ retry: 1, status: "passed" });
    expect(flakyReport.status).toBe("passed");

    expect(payload.tests[2]!.status).toBe("skipped");
    expect(payload.tests[2]!.attempts).toEqual([]);
    expect(payload.tests[3]!.status).toBe("failed");
  });

  it("truncates errors and output", async () => {
    const test = makeTest({
      results: [
        makeResult({
          status: "failed",
          errors: [makeError("abcdefghij", { stack: "stack-abcdefghij" })],
          stdout: ["hello world"],
          stderr: ["oops"],
        }),
      ],
    });

    const payload = await build([test], {
      includeStdout: true,
      maxErrorLength: 5,
      maxOutputLength: 5,
    });
    const attempt = payload.tests[0]!.attempts[0]!;

    expect(attempt.errors[0]!.message.startsWith("abcde")).toBe(true);
    expect(attempt.errors[0]!.message).toContain("[truncated]");
    expect(attempt.errors[0]!.stack?.startsWith("stack")).toBe(true);
    expect(attempt.errors[0]!.stack).toContain("[truncated]");
    expect(attempt.stdout).toEqual(["hello\n... [truncated]"]);
    expect(attempt.stderr).toEqual(["oops"]);
  });

  it("omits output and steps when disabled", async () => {
    const test = makeTest({
      results: [
        makeResult({
          steps: [makeStep()],
          stdout: ["hello"],
          stderr: ["world"],
        }),
      ],
    });

    const payload = await build([test], {
      includeStdout: false,
      includeSteps: false,
    });
    const attempt = payload.tests[0]!.attempts[0]!;

    expect(attempt.steps).toBeUndefined();
    expect(attempt.stdout).toBeUndefined();
    expect(attempt.stderr).toBeUndefined();
  });

  it("serializes reporter-level errors", async () => {
    const payload = await build([makeTest()], {}, [makeError("global teardown failed")]);

    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]!.message).toBe("global teardown failed");
  });

  it("includes attachment metadata without bodies by default", async () => {
    const test = makeTest({
      results: [
        makeResult({
          attachments: [makeAttachment({ body: Buffer.from("hello") })],
        }),
      ],
    });

    const payload = await build([test]);
    const attachment = payload.tests[0]!.attempts[0]!.attachments[0]!;

    expect(attachment).toMatchObject({
      name: "screenshot",
      contentType: "image/png",
      size: 5,
    });
    expect(attachment.body).toBeUndefined();
  });

  it("inlines attachment bodies and enforces the size limit", async () => {
    const inline = makeTest({
      results: [
        makeResult({
          attachments: [makeAttachment({ body: Buffer.from("hello") })],
        }),
      ],
    });
    const tooLarge = makeTest({
      id: "large",
      results: [
        makeResult({
          attachments: [makeAttachment({ body: Buffer.from("0123456789") })],
        }),
      ],
    });

    const payload = await build([inline, tooLarge], {
      includeAttachments: true,
      maxAttachmentSize: 5,
    });

    expect(payload.tests[0]!.attempts[0]!.attachments[0]!.body).toBe(
      Buffer.from("hello").toString("base64"),
    );
    expect(payload.tests[1]!.attempts[0]!.attachments[0]).toMatchObject({
      size: 10,
      omitted: "too-large",
    });
    expect(payload.tests[1]!.attempts[0]!.attachments[0]!.body).toBeUndefined();
  });

  it("reads attachment bodies from disk", async () => {
    const file = join(tempDirectory, "trace.zip");
    await writeFile(file, "trace-data");

    const test = makeTest({
      results: [makeResult({ attachments: [makeAttachment({ path: file, contentType: "application/zip" })] })],
    });

    const payload = await build([test], { includeAttachments: true });
    const attachment = payload.tests[0]!.attempts[0]!.attachments[0]!;

    expect(attachment.path).toBe(file);
    expect(attachment.size).toBe(10);
    expect(attachment.body).toBe(Buffer.from("trace-data").toString("base64"));
  });

  it("marks unreadable attachments", async () => {
    const test = makeTest({
      results: [
        makeResult({
          attachments: [makeAttachment({ path: join(tempDirectory, "missing.txt") })],
        }),
      ],
    });

    const payload = await build([test], { includeAttachments: true });

    expect(payload.tests[0]!.attempts[0]!.attachments[0]!.omitted).toBe("unreadable");
  });
});
