import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { FetchLike } from "../src/options.js";
import { sendReport, type SendReportOptions } from "../src/transport.js";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordingFetch(
  handler: (call: RecordedCall, index: number) => Response | Promise<Response>,
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetch, calls };
}

function makeOptions(
  fetch: FetchLike,
  overrides: Partial<SendReportOptions> = {},
): SendReportOptions {
  return {
    url: "https://ci.example.com/report",
    method: "POST",
    headers: {},
    timeout: 1_000,
    retries: 0,
    retryDelay: 1,
    gzip: false,
    fetch,
    runId: "run-1",
    verbose: false,
    log: () => {},
    ...overrides,
  };
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

describe("sendReport", () => {
  it("posts JSON with default and custom headers", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const result = await sendReport(
      { hello: "world" },
      makeOptions(fetch, {
        token: "secret",
        headers: { "X-Custom": "yes" },
      }),
    );

    expect(result).toEqual({ ok: true, attempts: 1, status: 204 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://ci.example.com/report");
    expect(calls[0]!.init.method).toBe("POST");
    expect(headerValue(calls[0]!.init, "content-type")).toBe("application/json");
    expect(headerValue(calls[0]!.init, "authorization")).toBe("Bearer secret");
    expect(headerValue(calls[0]!.init, "x-custom")).toBe("yes");
    expect(headerValue(calls[0]!.init, "x-playwright-run-id")).toBe("run-1");
    expect(headerValue(calls[0]!.init, "user-agent")).toMatch(
      /^@chaocw\/playwright-http-reporter\//,
    );
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ hello: "world" });
  });

  it("does not override an explicit authorization header", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 200 }));
    await sendReport(
      {},
      makeOptions(fetch, {
        token: "secret",
        headers: { authorization: "Basic abc" },
      }),
    );

    expect(headerValue(calls[0]!.init, "authorization")).toBe("Basic abc");
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).toHaveLength(5);
  });

  it("retries retryable status codes", async () => {
    const { fetch, calls } = recordingFetch((_call, index) =>
      index < 2 ? new Response("busy", { status: 503 }) : new Response(null, { status: 201 }),
    );
    const result = await sendReport({}, makeOptions(fetch, { retries: 2, retryDelay: 0 }));

    expect(result).toEqual({ ok: true, attempts: 3, status: 201 });
    expect(calls).toHaveLength(3);
  });

  it("stops on non-retryable client errors", async () => {
    const { fetch, calls } = recordingFetch(
      () => new Response("invalid token", { status: 401 }),
    );
    const result = await sendReport({}, makeOptions(fetch, { retries: 3, retryDelay: 0 }));

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.status).toBe(401);
    expect(result.error).toContain("HTTP 401");
    expect(result.error).toContain("invalid token");
    expect(calls).toHaveLength(1);
  });

  it("retries network errors", async () => {
    const { fetch, calls } = recordingFetch((_call, index) => {
      if (index === 0) throw new Error("ECONNREFUSED");
      return new Response(null, { status: 200 });
    });
    const result = await sendReport({}, makeOptions(fetch, { retries: 1, retryDelay: 0 }));

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("honours Retry-After", async () => {
    const { fetch, calls } = recordingFetch((_call, index) =>
      index === 0
        ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } })
        : new Response(null, { status: 200 }),
    );
    const result = await sendReport({}, makeOptions(fetch, { retries: 1, retryDelay: 0 }));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("times out stalled requests", async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });

    const result = await sendReport({}, makeOptions(fetch, { timeout: 20 }));

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toBe("request timed out after 20ms");
  });

  it("gzips the body when enabled", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 200 }));
    const result = await sendReport({ compressed: true }, makeOptions(fetch, { gzip: true }));

    expect(result.ok).toBe(true);
    expect(headerValue(calls[0]!.init, "content-encoding")).toBe("gzip");
    const decoded = gunzipSync(calls[0]!.init.body as Uint8Array).toString("utf8");
    expect(JSON.parse(decoded)).toEqual({ compressed: true });
  });

  it("returns a serialization error for non-JSON payloads", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 200 }));
    const result = await sendReport({ value: 10n }, makeOptions(fetch));

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error).toContain("failed to serialize payload");
    expect(calls).toHaveLength(0);
  });
});
