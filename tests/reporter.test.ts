import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/options.js";
import type { ReportPayload } from "../src/payload.js";
import { HttpReporter } from "../src/reporter.js";
import {
  makeConfig,
  makeError,
  makeFullResult,
  makeResult,
  makeSuite,
  makeTest,
} from "./helpers.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordingFetch(
  handler: (call: RecordedCall, index: number) => Response | Promise<Response> = () =>
    new Response(null, { status: 202 }),
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch, calls };
}

function payloadOf(call: RecordedCall | undefined): ReportPayload {
  if (!call) throw new Error("expected an HTTP request");
  return JSON.parse(call.init.body as string) as ReportPayload;
}

const tempDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pw-http-reporter-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("HttpReporter", () => {
  it("uploads a complete report on end", async () => {
    const { fetch, calls } = recordingFetch();
    const suite = makeSuite([
      makeTest({
        title: "checkout works",
        tags: ["@smoke"],
        results: [makeResult({ status: "passed", duration: 12 })],
      }),
    ]);
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      token: "secret",
      metadata: { environment: "staging" },
      fetch,
    });

    reporter.onBegin(makeConfig(), suite);
    await reporter.onEnd(makeFullResult());

    expect(reporter.printsToStdio()).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://ci.example.com/report");

    const payload = payloadOf(calls[0]);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.run.status).toBe("passed");
    expect(payload.run.metadata).toEqual({ environment: "staging" });
    expect(payload.summary.total).toBe(1);
    expect(payload.tests[0]).toMatchObject({
      title: "checkout works",
      status: "passed",
      outcome: "expected",
      tags: ["@smoke"],
    });
  });

  it("skips successful runs when onlyOnFailure is enabled", async () => {
    const { fetch, calls } = recordingFetch();
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      onlyOnFailure: true,
      fetch,
    });

    reporter.onBegin(makeConfig(), makeSuite([makeTest()]));
    await reporter.onEnd(makeFullResult());

    expect(calls).toHaveLength(0);
  });

  it("uploads failed runs when onlyOnFailure is enabled", async () => {
    const { fetch, calls } = recordingFetch();
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      onlyOnFailure: true,
      fetch,
    });
    const suite = makeSuite([
      makeTest({
        outcome: "unexpected",
        results: [makeResult({ status: "failed", errors: [makeError("boom")] })],
      }),
    ]);

    reporter.onBegin(makeConfig(), suite);
    await reporter.onEnd(makeFullResult({ status: "failed" }));

    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0]).summary.unexpected).toBe(1);
  });

  it("uploads flaky runs when onlyOnFailure is enabled", async () => {
    const { fetch, calls } = recordingFetch();
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      onlyOnFailure: true,
      fetch,
    });
    const suite = makeSuite([
      makeTest({
        outcome: "flaky",
        results: [
          makeResult({ retry: 0, status: "failed", errors: [makeError("first try")] }),
          makeResult({ retry: 1, status: "passed" }),
        ],
      }),
    ]);

    reporter.onBegin(makeConfig(), suite);
    await reporter.onEnd(makeFullResult());

    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0]).summary.flaky).toBe(1);
  });

  it("treats expected failures as successful when onlyOnFailure is enabled", async () => {
    const { fetch, calls } = recordingFetch();
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      onlyOnFailure: true,
      fetch,
    });
    const suite = makeSuite([
      makeTest({
        outcome: "expected",
        expectedStatus: "failed",
        results: [makeResult({ status: "failed", errors: [makeError("known issue")] })],
      }),
    ]);

    reporter.onBegin(makeConfig(), suite);
    await reporter.onEnd(makeFullResult());

    expect(calls).toHaveLength(0);
  });

  it("uploads when the runner reported an error", async () => {
    const { fetch, calls } = recordingFetch();
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      onlyOnFailure: true,
      fetch,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    reporter.onBegin(makeConfig(), makeSuite([makeTest()]));
    reporter.onError(makeError("global teardown failed"));
    await reporter.onEnd(makeFullResult());

    expect(calls).toHaveLength(1);
    expect(payloadOf(calls[0]).errors[0]!.message).toBe("global teardown failed");
  });

  it("applies transformPayload before uploading", async () => {
    const { fetch, calls } = recordingFetch();
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      fetch,
      transformPayload: (payload) => ({
        ...payload,
        run: { ...payload.run, metadata: { transformed: true } },
      }),
    });

    reporter.onBegin(makeConfig(), makeSuite([makeTest()]));
    await reporter.onEnd(makeFullResult());

    expect(payloadOf(calls[0]).run.metadata).toEqual({ transformed: true });
  });

  it("saves the report to disk when the upload fails", async () => {
    const directory = await tempDirectory();
    const { fetch, calls } = recordingFetch(
      () => new Response("server down", { status: 503 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      retries: 1,
      retryDelay: 0,
      fallbackDir: directory,
      fetch,
    });

    reporter.onBegin(makeConfig(), makeSuite([makeTest()]));
    await reporter.onEnd(makeFullResult());

    expect(calls).toHaveLength(2);
    const file = join(directory, `playwright-http-reporter-${payloadOf(calls[0]).run.id}.json`);
    const saved = JSON.parse(await readFile(file, "utf8"));

    expect(saved.error).toContain("HTTP 503");
    expect(saved.attempts).toBe(2);
    expect(saved.endpoint).toBe("https://ci.example.com/report");
    expect(saved.reporter.name).toBe("@chaocw/playwright-http-reporter");
    expect(saved.payload.schemaVersion).toBe(1);
  });

  it("saves the original report when transformPayload throws", async () => {
    const directory = await tempDirectory();
    const { fetch, calls } = recordingFetch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      fallbackDir: directory,
      fetch,
      transformPayload: () => {
        throw new Error("redaction failed");
      },
    });

    reporter.onBegin(makeConfig(), makeSuite([makeTest()]));
    await reporter.onEnd(makeFullResult());

    expect(calls).toHaveLength(0);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const saved = JSON.parse(await readFile(join(directory, files[0]!), "utf8"));
    expect(saved.error).toContain("transformPayload threw");
    expect(saved.attempts).toBe(0);
    expect(saved.payload.schemaVersion).toBe(1);
  });

  it("throws when failOnError is enabled and the upload fails", async () => {
    const directory = await tempDirectory();
    const { fetch } = recordingFetch(() => new Response("nope", { status: 400 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = new HttpReporter({
      endpoint: "https://ci.example.com/report",
      fallbackDir: directory,
      failOnError: true,
      fetch,
    });

    reporter.onBegin(makeConfig(), makeSuite([makeTest()]));

    await expect(reporter.onEnd(makeFullResult())).rejects.toThrow("report upload failed");
  });
});
