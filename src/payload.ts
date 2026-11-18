import { readFile, stat } from "node:fs/promises";

import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

import { detectCi, type CiInfo } from "./ci.js";
import { REPORTER_NAME, REPORTER_VERSION } from "./version.js";

export type TestStatus = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
export type TestOutcome = "expected" | "unexpected" | "flaky" | "skipped";
export type RunStatus = FullResult["status"];

export interface ReportLocation {
  file: string;
  line: number;
  column: number;
}

export interface ReportError {
  message: string;
  value?: string;
  stack?: string;
  snippet?: string;
  location?: ReportLocation;
}

export interface ReportStep {
  title: string;
  subtitle?: string;
  category: string;
  duration: number;
  location?: ReportLocation;
  error?: ReportError;
  steps?: ReportStep[];
}

export interface ReportAttachment {
  name: string;
  contentType: string;
  path?: string;
  size?: number;
  body?: string;
  omitted?: "too-large" | "unreadable";
}

export interface ReportAttempt {
  retry: number;
  status: TestStatus;
  duration: number;
  startTime: string;
  workerIndex: number;
  parallelIndex: number;
  errors: ReportError[];
  steps?: ReportStep[];
  attachments: ReportAttachment[];
  stdout?: string[];
  stderr?: string[];
}

export interface ReportAnnotation {
  type: string;
  description?: string;
}

export interface ReportTest {
  id: string;
  title: string;
  titlePath: string[];
  file: string;
  line: number;
  column: number;
  projectName?: string;
  tags: string[];
  annotations: ReportAnnotation[];
  expectedStatus: TestStatus;
  outcome: TestOutcome;
  status: TestStatus;
  repeatEachIndex: number;
  attempts: ReportAttempt[];
}

export interface ReportSummary {
  total: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  passed: number;
  failed: number;
  timedOut: number;
  interrupted: number;
}

export interface ReportProject {
  name: string;
  retries: number;
  timeout: number;
  repeatEach: number;
  outputDir: string;
  testDir: string;
}

export interface ReportConfig {
  rootDir: string;
  configFile?: string;
  workers: number;
  globalTimeout: number;
  maxFailures: number;
  fullyParallel: boolean;
  forbidOnly: boolean;
  updateSnapshots: FullConfig["updateSnapshots"];
  shard?: { current: number; total: number };
  projects: ReportProject[];
}

export interface ReportRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  duration: number;
  status: RunStatus;
  playwrightVersion: string;
  reporter: { name: string; version: string };
  runtime: { node: string; platform: string; arch: string };
  config: ReportConfig;
  ci: CiInfo;
  metadata?: Record<string, unknown>;
}

export interface ReportPayload {
  schemaVersion: 1;
  run: ReportRun;
  summary: ReportSummary;
  tests: ReportTest[];
  errors: ReportError[];
}

export interface ReportLimits {
  includeAttachments: boolean;
  maxAttachmentSize: number;
  includeStdout: boolean;
  includeSteps: boolean;
  maxErrorLength: number;
  maxOutputLength: number;
}

export interface BuildReportOptions {
  runId: string;
  config: FullConfig;
  suite: Suite;
  result: FullResult;
  errors: TestError[];
  metadata?: Record<string, unknown>;
  limits: ReportLimits;
}

const MAX_STEP_DEPTH = 40;

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0 || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... [truncated]`;
}

function serializeLocation(location: { file: string; line: number; column: number } | undefined): ReportLocation | undefined {
  if (!location) return undefined;
  return { file: location.file, line: location.line, column: location.column };
}

function serializeError(error: TestError | undefined, maxErrorLength: number): ReportError | undefined {
  if (!error) return undefined;

  const message = error.message ?? error.value ?? "Unknown error";
  const result: ReportError = { message: truncate(message, maxErrorLength) };
  if (error.value !== undefined && error.message !== undefined) {
    result.value = truncate(error.value, maxErrorLength);
  }
  if (error.stack !== undefined) result.stack = truncate(error.stack, maxErrorLength);
  if (error.snippet !== undefined) result.snippet = truncate(error.snippet, maxErrorLength);
  const location = serializeLocation(error.location);
  if (location) result.location = location;
  return result;
}

function serializeStep(step: TestStep, limits: ReportLimits, depth = 0): ReportStep {
  const result: ReportStep = {
    title: step.title,
    category: step.category,
    duration: step.duration,
  };
  if (step.subtitle) result.subtitle = step.subtitle;

  const location = serializeLocation(step.location);
  if (location) result.location = location;

  const error = serializeError(step.error, limits.maxErrorLength);
  if (error) result.error = error;

  if (step.steps.length > 0 && depth < MAX_STEP_DEPTH) {
    result.steps = step.steps.map((child) => serializeStep(child, limits, depth + 1));
  }
  return result;
}

function serializeOutput(
  chunks: ReadonlyArray<string | Buffer>,
  maxOutputLength: number,
): string[] | undefined {
  if (chunks.length === 0) return undefined;

  const output: string[] = [];
  let used = 0;
  for (const chunk of chunks) {
    let text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (maxOutputLength > 0 && used + text.length > maxOutputLength) {
      text = `${text.slice(0, Math.max(0, maxOutputLength - used))}\n... [truncated]`;
      output.push(text);
      break;
    }
    output.push(text);
    used += text.length;
  }
  return output;
}

async function inlineAttachment(
  attachment: TestResult["attachments"][number],
  maxAttachmentSize: number,
): Promise<ReportAttachment> {
  const result: ReportAttachment = {
    name: attachment.name,
    contentType: attachment.contentType,
  };
  if (attachment.path) result.path = attachment.path;
  if (attachment.body) result.size = attachment.body.byteLength;

  try {
    if (attachment.body) {
      if (maxAttachmentSize > 0 && attachment.body.byteLength > maxAttachmentSize) {
        result.omitted = "too-large";
      } else {
        result.body = attachment.body.toString("base64");
      }
      return result;
    }

    if (attachment.path) {
      const info = await stat(attachment.path);
      result.size = info.size;
      if (maxAttachmentSize > 0 && info.size > maxAttachmentSize) {
        result.omitted = "too-large";
        return result;
      }
      result.body = (await readFile(attachment.path)).toString("base64");
    }
  } catch {
    result.omitted = "unreadable";
  }

  return result;
}

async function serializeAttempt(result: TestResult, limits: ReportLimits): Promise<ReportAttempt> {
  const attempt: ReportAttempt = {
    retry: result.retry,
    status: result.status,
    duration: result.duration,
    startTime: result.startTime.toISOString(),
    workerIndex: result.workerIndex,
    parallelIndex: result.parallelIndex,
    errors: result.errors.map((error) => serializeError(error, limits.maxErrorLength)).filter((error): error is ReportError => Boolean(error)),
    attachments: [],
  };

  if (limits.includeSteps) {
    attempt.steps = result.steps.map((step) => serializeStep(step, limits));
  }

  if (limits.includeStdout) {
    const stdout = serializeOutput(result.stdout, limits.maxOutputLength);
    const stderr = serializeOutput(result.stderr, limits.maxOutputLength);
    if (stdout) attempt.stdout = stdout;
    if (stderr) attempt.stderr = stderr;
  }

  for (const attachment of result.attachments) {
    if (limits.includeAttachments) {
      attempt.attachments.push(await inlineAttachment(attachment, limits.maxAttachmentSize));
    } else {
      const metadata: ReportAttachment = {
        name: attachment.name,
        contentType: attachment.contentType,
      };
      if (attachment.path) metadata.path = attachment.path;
      if (attachment.body) metadata.size = attachment.body.byteLength;
      attempt.attachments.push(metadata);
    }
  }

  return attempt;
}

async function serializeTest(test: TestCase, limits: ReportLimits): Promise<ReportTest> {
  const attempts: ReportAttempt[] = [];
  for (const result of test.results) {
    attempts.push(await serializeAttempt(result, limits));
  }

  const last = test.results[test.results.length - 1];
  const report: ReportTest = {
    id: test.id,
    title: test.title,
    titlePath: test.titlePath(),
    file: test.location.file,
    line: test.location.line,
    column: test.location.column,
    tags: [...test.tags],
    annotations: test.annotations.map((annotation) => {
      const item: ReportAnnotation = { type: annotation.type };
      if (annotation.description !== undefined) item.description = annotation.description;
      return item;
    }),
    expectedStatus: test.expectedStatus,
    outcome: test.outcome(),
    status: last?.status ?? "skipped",
    repeatEachIndex: test.repeatEachIndex,
    attempts,
  };

  const projectName = test.parent.project()?.name;
  if (projectName) report.projectName = projectName;
  return report;
}

function buildSummary(tests: ReportTest[]): ReportSummary {
  const summary: ReportSummary = {
    total: tests.length,
    expected: 0,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
    passed: 0,
    failed: 0,
    timedOut: 0,
    interrupted: 0,
  };

  for (const test of tests) {
    summary[test.outcome] += 1;
    if (test.status === "passed") summary.passed += 1;
    else if (test.status === "failed") summary.failed += 1;
    else if (test.status === "timedOut") summary.timedOut += 1;
    else if (test.status === "interrupted") summary.interrupted += 1;
  }

  return summary;
}

function buildConfig(config: FullConfig): ReportConfig {
  const report: ReportConfig = {
    rootDir: config.rootDir,
    workers: config.workers,
    globalTimeout: config.globalTimeout,
    maxFailures: config.maxFailures,
    fullyParallel: config.fullyParallel,
    forbidOnly: config.forbidOnly,
    updateSnapshots: config.updateSnapshots,
    projects: config.projects.map((project) => ({
      name: project.name,
      retries: project.retries,
      timeout: project.timeout,
      repeatEach: project.repeatEach,
      outputDir: project.outputDir,
      testDir: project.testDir,
    })),
  };
  if (config.configFile) report.configFile = config.configFile;
  if (config.shard) report.shard = { ...config.shard };
  return report;
}

/** Converts Playwright run data into the stable wire format. */
export async function buildReport(options: BuildReportOptions): Promise<ReportPayload> {
  const { config, suite, result, limits } = options;
  const tests: ReportTest[] = [];
  for (const test of suite.allTests()) {
    tests.push(await serializeTest(test, limits));
  }

  const startedAt = result.startTime;
  const finishedAt = new Date(startedAt.getTime() + result.duration);

  const run: ReportRun = {
    id: options.runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    duration: result.duration,
    status: result.status,
    playwrightVersion: config.version,
    reporter: { name: REPORTER_NAME, version: REPORTER_VERSION },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    config: buildConfig(config),
    ci: detectCi(),
  };
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    run.metadata = options.metadata;
  }

  return {
    schemaVersion: 1,
    run,
    summary: buildSummary(tests),
    tests,
    errors: options.errors
      .map((error) => serializeError(error, limits.maxErrorLength))
      .filter((error): error is ReportError => Boolean(error)),
  };
}
