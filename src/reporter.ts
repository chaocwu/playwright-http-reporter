import { randomUUID } from "node:crypto";

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";

import { postEvent, type ReporterEvent } from "./http.js";
import {
  resolveOptions,
  type HttpReporterOptions,
  type ResolvedOptions,
} from "./options.js";

/**
 * Sends one HTTP request per reporter event. Playwright's TestResult is
 * forwarded as-is; no summary or custom result schema is produced.
 */
export class HttpReporter implements Reporter {
  private readonly options: ResolvedOptions;
  private readonly runId = randomUUID();
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: HttpReporterOptions) {
    this.options = resolveOptions(options);
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.enqueue({
      event: "begin",
      data: { totalTests: suite.allTests().length },
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.enqueue({
      event: "testEnd",
      data: {
        test: {
          id: test.id,
          title: test.title,
          titlePath: test.titlePath(),
          location: test.location,
          projectName: test.parent.project()?.name,
          tags: test.tags,
          annotations: test.annotations,
          expectedStatus: test.expectedStatus,
          outcome: test.outcome(),
          repeatEachIndex: test.repeatEachIndex,
        },
        result,
      },
    });
  }

  onError(error: TestError): void {
    this.enqueue({ event: "error", data: error });
  }

  async onEnd(result: FullResult): Promise<void> {
    this.enqueue({ event: "end", data: result });
    await this.queue;
  }

  printsToStdio(): boolean {
    return false;
  }

  private enqueue(
    event: Omit<ReporterEvent, "runId" | "seq" | "timestamp">,
  ): void {
    const payload: ReporterEvent = {
      runId: this.runId,
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.queue = this.queue.then(() => this.send(payload));
  }

  private async send(event: ReporterEvent): Promise<void> {
    try {
      await postEvent(event, this.options);
      if (this.options.verbose) {
        console.error(`[playwright-http-reporter] sent ${event.event}`);
      }
    } catch (error) {
      console.error(
        `[playwright-http-reporter] failed to send ${event.event}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export default HttpReporter;
