import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";

import type { ReporterEvent } from "../src/http";
import { HttpReporter } from "../src/reporter";
import {
  makeConfig,
  makeFullResult,
  makeResult,
  makeSuite,
  makeTestCase,
} from "./helpers";

let server: ReturnType<typeof Bun.serve>;
let requests: ReporterEvent[] = [];

server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === "/fail") {
      return new Response("down", { status: 400 });
    }
    requests.push((await request.json()) as ReporterEvent);
    return new Response(null, { status: 204 });
  },
});

const endpoint = `http://127.0.0.1:${server.port}/report`;

beforeEach(() => {
  requests = [];
});

afterAll(() => {
  server.stop(true);
});

describe("HttpReporter", () => {
  it("sends begin, testEnd and end events in order", async () => {
    const step = { title: "step", steps: [] as unknown[] } as Record<string, unknown>;
    step.parent = step;

    const result = makeResult({
      status: "failed",
      duration: 321,
      errors: [{ message: "boom", stack: "stack" }],
      steps: [step] as never,
      stdout: ["hello"],
      stderr: ["warning"],
      attachments: [
        { name: "screenshot", contentType: "image/png", path: "test-results/a.png" },
      ],
      retry: 2,
    });
    const test = makeTestCase({
      id: "abc",
      title: "checkout works",
      outcome: () => "unexpected",
      results: [result],
    });
    const reporter = new HttpReporter({ endpoint, retries: 0 });
    reporter.onBegin(makeConfig(), makeSuite([test]));
    reporter.onTestEnd(test, result);
    await reporter.onEnd(makeFullResult({ status: "failed", duration: 999 }));

    expect(reporter.printsToStdio()).toBe(false);
    expect(requests.map((item) => item.event)).toEqual(["begin", "testEnd", "end"]);
    expect(new Set(requests.map((item) => item.runId)).size).toBe(1);

    const testEvent = requests[1]!.data as {
      test: { id: string; title: string; projectName: string };
      result: {
        status: string;
        duration: number;
        stdout: string[];
        steps: Array<{ parent: string }>;
      };
    };
    expect(testEvent.test).toMatchObject({
      id: "abc",
      title: "checkout works",
      projectName: "chromium",
    });
    expect(testEvent.result).toMatchObject({
      status: "failed",
      duration: 321,
      stdout: ["hello"],
      stderr: ["warning"],
      retry: 2,
      attachments: [
        { name: "screenshot", contentType: "image/png", path: "test-results/a.png" },
      ],
    });
    expect(testEvent.result.steps[0]!.parent).toBe("[Circular]");

    expect(requests[0]!.data).toEqual({ totalTests: 1 });
    expect(requests[2]!.data).toMatchObject({ status: "failed", duration: 999 });
  });

  it("sends runner errors", async () => {
    const reporter = new HttpReporter({ endpoint, retries: 0 });
    reporter.onError({ message: "global teardown failed" });
    await reporter.onEnd(makeFullResult());

    expect(requests.map((item) => item.event)).toEqual(["error", "end"]);
    expect(requests[0]!.data).toMatchObject({ message: "global teardown failed" });
  });

  it("does not reject when the endpoint fails", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const reporter = new HttpReporter({ endpoint: endpoint.replace("/report", "/fail"), retries: 0 });

    reporter.onBegin(makeConfig(), makeSuite([]));
    await reporter.onEnd(makeFullResult());

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
