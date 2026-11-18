import { describe, expect, it } from "bun:test";

import { postEvent, serializeEvent, type ReporterEvent } from "../src/http";
import type { ResolvedOptions } from "../src/options";

const event: ReporterEvent = {
  runId: "run-1",
  event: "testEnd",
  timestamp: "2026-01-01T00:00:00.000Z",
  data: { result: { status: "passed" } },
};

const options: ResolvedOptions = {
  endpoint: "https://example.com/report",
  token: undefined,
  headers: {},
  timeout: 1_000,
  retries: 0,
  verbose: false,
};

function recordingFetch(handler: (call: { url: string; init: RequestInit }, index: number) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function header(init: RequestInit, name: string): string | undefined {
  return Object.entries(init.headers as Record<string, string>).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}

describe("serializeEvent", () => {
  it("handles circular references, functions and bigints", () => {
    const data: Record<string, unknown> = { value: 10n, fn: () => {} };
    data.self = data;

    expect(JSON.parse(serializeEvent({ ...event, data }))).toEqual({
      runId: "run-1",
      event: "testEnd",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: { value: "10", self: "[Circular]" },
    });
  });
});

describe("postEvent", () => {
  it("posts the event with auth and custom headers", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 204 }));

    await postEvent(event, {
      ...options,
      token: "secret",
      headers: { "X-Custom": "yes" },
      fetch,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.com/report");
    expect(calls[0]!.init.method).toBe("POST");
    expect(header(calls[0]!.init, "content-type")).toBe("application/json");
    expect(header(calls[0]!.init, "authorization")).toBe("Bearer secret");
    expect(header(calls[0]!.init, "x-custom")).toBe("yes");
    expect(JSON.parse(calls[0]!.init.body as string).event).toBe("testEnd");
  });

  it("keeps an explicit authorization header", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 204 }));

    await postEvent(event, {
      ...options,
      token: "secret",
      headers: { authorization: "Basic abc" },
      fetch,
    });

    expect(header(calls[0]!.init, "authorization")).toBe("Basic abc");
  });

  it("retries retryable responses", async () => {
    const { fetch, calls } = recordingFetch((_call, index) =>
      index === 0 ? new Response("busy", { status: 503 }) : new Response(null, { status: 204 }),
    );

    await postEvent(event, { ...options, retries: 1, fetch });

    expect(calls).toHaveLength(2);
  });

  it("does not retry client errors", async () => {
    const { fetch, calls } = recordingFetch(() => new Response("nope", { status: 400 }));

    await expect(postEvent(event, { ...options, retries: 3, fetch })).rejects.toThrow("HTTP 400");
    expect(calls).toHaveLength(1);
  });

  it("times out stalled requests", async () => {
    const fetch = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as typeof globalThis.fetch;

    await expect(postEvent(event, { ...options, timeout: 20, fetch })).rejects.toThrow(
      "timed out after 20ms",
    );
  });
});
