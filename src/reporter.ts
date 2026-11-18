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

import { saveFallback } from "./fallback.js";
import { resolveOptions, type HttpReporterOptions, type ResolvedOptions } from "./options.js";
import { buildReport, type ReportPayload } from "./payload.js";
import { sendReport } from "./transport.js";
import { REPORTER_NAME } from "./version.js";

/**
 * Collects the complete Playwright run and uploads it as a single JSON report
 * when the run ends.
 *
 * ```ts
 * // playwright.config.ts
 * reporter: [["@chaocw/playwright-http-reporter", { endpoint: "https://ci.example.com/report" }]]
 * ```
 */
export class HttpReporter implements Reporter {
  private readonly options: ResolvedOptions;
  private readonly runId = randomUUID();
  private readonly errors: TestError[] = [];
  private config: FullConfig | undefined;
  private suite: Suite | undefined;
  private completedTests = 0;

  constructor(options: HttpReporterOptions) {
    this.options = resolveOptions(options);
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.error(`[${REPORTER_NAME}] ${message}`);
    }
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.log(`run ${this.runId}: collected ${suite.allTests().length} tests`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.completedTests += 1;
    this.log(
      `${result.status} "${test.title}" (${result.duration}ms, ${this.completedTests} completed)`,
    );
  }

  onError(error: TestError): void {
    this.errors.push(error);
    console.error(`[${REPORTER_NAME}] runner error: ${error.message ?? error.value ?? "unknown"}`);
  }

  private isSuccessful(payload: ReportPayload): boolean {
    const { summary, run, errors } = payload;
    return (
      run.status === "passed" &&
      summary.unexpected === 0 &&
      summary.flaky === 0 &&
      errors.length === 0
    );
  }

  private async fail(message: string, payload: unknown, attempts: number): Promise<void> {
    const detail = `report upload failed${attempts > 0 ? ` after ${attempts} attempt(s)` : ""}: ${message}`;
    console.error(`[${REPORTER_NAME}] ${detail}`);

    if (payload !== undefined) {
      const file = await saveFallback(this.options.fallbackDir, {
        runId: this.runId,
        endpoint: this.options.endpoint,
        error: message,
        attempts,
        payload,
      });
      if (file) {
        console.error(`[${REPORTER_NAME}] undelivered report saved to ${file}`);
      }
    }

    if (this.options.failOnError) {
      throw new Error(`[${REPORTER_NAME}] ${detail}`);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!this.config || !this.suite) {
      this.log("onEnd called before onBegin; nothing to upload");
      return;
    }

    let payload: ReportPayload;
    try {
      payload = await buildReport({
        runId: this.runId,
        config: this.config,
        suite: this.suite,
        result,
        errors: this.errors,
        metadata: this.options.metadata,
        limits: {
          includeAttachments: this.options.includeAttachments,
          maxAttachmentSize: this.options.maxAttachmentSize,
          includeStdout: this.options.includeStdout,
          includeSteps: this.options.includeSteps,
          maxErrorLength: this.options.maxErrorLength,
          maxOutputLength: this.options.maxOutputLength,
        },
      });
    } catch (error) {
      await this.fail(
        `could not build report: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        0,
      );
      return;
    }

    if (this.options.onlyOnFailure && this.isSuccessful(payload)) {
      this.log("run passed; skipping upload because onlyOnFailure is enabled");
      return;
    }

    let outgoing = payload;
    if (this.options.transformPayload) {
      try {
        outgoing = await this.options.transformPayload(payload);
      } catch (error) {
        await this.fail(
          `transformPayload threw: ${error instanceof Error ? error.message : String(error)}`,
          payload,
          0,
        );
        return;
      }
    }

    const sent = await sendReport(outgoing, {
      url: this.options.endpoint,
      method: this.options.method,
      token: this.options.token,
      headers: this.options.headers,
      timeout: this.options.timeout,
      retries: this.options.retries,
      retryDelay: this.options.retryDelay,
      gzip: this.options.gzip,
      fetch: this.options.fetch,
      runId: this.runId,
      verbose: this.options.verbose,
      log: (message) => this.log(message),
    });

    if (sent.ok) {
      this.log(
        `uploaded run ${this.runId} (${payload.summary.total} tests, status ${payload.run.status})`,
      );
      return;
    }

    await this.fail(sent.error ?? "unknown upload error", outgoing, sent.attempts);
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default HttpReporter;
