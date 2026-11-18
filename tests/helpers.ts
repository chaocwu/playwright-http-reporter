import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

import type { TestOutcome, TestStatus } from "../src/payload.js";

export interface ResultFixtureOptions {
  retry?: number;
  status?: TestStatus;
  duration?: number;
  startTime?: Date;
  errors?: TestError[];
  steps?: TestStep[];
  attachments?: TestResult["attachments"];
  stdout?: Array<string | Buffer>;
  stderr?: Array<string | Buffer>;
  workerIndex?: number;
  parallelIndex?: number;
}

export function makeResult(options: ResultFixtureOptions = {}): TestResult {
  return {
    retry: options.retry ?? 0,
    status: options.status ?? "passed",
    duration: options.duration ?? 100,
    startTime: options.startTime ?? new Date("2026-01-01T00:00:00.000Z"),
    errors: options.errors ?? [],
    steps: options.steps ?? [],
    attachments: options.attachments ?? [],
    stdout: options.stdout ?? [],
    stderr: options.stderr ?? [],
    workerIndex: options.workerIndex ?? 0,
    parallelIndex: options.parallelIndex ?? 0,
  } as unknown as TestResult;
}

export interface TestFixtureOptions {
  id?: string;
  title?: string;
  outcome?: TestOutcome;
  expectedStatus?: TestStatus;
  results?: TestResult[];
  projectName?: string;
  tags?: string[];
  annotations?: TestCase["annotations"];
  file?: string;
  line?: number;
  column?: number;
  repeatEachIndex?: number;
  titlePath?: string[];
}

export function makeTest(options: TestFixtureOptions = {}): TestCase {
  const title = options.title ?? "does something useful";
  return {
    id: options.id ?? "test-id",
    title,
    titlePath: () => options.titlePath ?? ["", "example.spec.ts", title],
    location: {
      file: options.file ?? "tests/example.spec.ts",
      line: options.line ?? 3,
      column: options.column ?? 1,
    },
    tags: options.tags ?? [],
    annotations: options.annotations ?? [],
    expectedStatus: options.expectedStatus ?? "passed",
    outcome: () => options.outcome ?? "expected",
    repeatEachIndex: options.repeatEachIndex ?? 0,
    results: options.results ?? [makeResult()],
    parent: {
      project: () => ({ name: options.projectName ?? "chromium" }),
    },
  } as unknown as TestCase;
}

export function makeSuite(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite;
}

export function makeConfig(overrides: Partial<FullConfig> = {}): FullConfig {
  return {
    version: "1.65.0",
    rootDir: "/repo",
    configFile: "/repo/playwright.config.ts",
    workers: 4,
    globalTimeout: 0,
    maxFailures: 0,
    fullyParallel: true,
    forbidOnly: false,
    updateSnapshots: "missing",
    shard: null,
    projects: [
      {
        name: "chromium",
        retries: 2,
        timeout: 30_000,
        repeatEach: 1,
        outputDir: "/repo/test-results",
        testDir: "/repo/tests",
      },
    ],
    ...overrides,
  } as unknown as FullConfig;
}

export function makeFullResult(overrides: Partial<FullResult> = {}): FullResult {
  return {
    status: "passed",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    duration: 1_234,
    ...overrides,
  } as FullResult;
}

export interface StepFixtureOptions {
  title?: string;
  category?: string;
  duration?: number;
  steps?: TestStep[];
  error?: TestError;
  location?: { file: string; line: number; column: number };
}

export function makeStep(options: StepFixtureOptions = {}): TestStep {
  return {
    title: options.title ?? "step",
    subtitle: undefined,
    category: options.category ?? "test.step",
    duration: options.duration ?? 1,
    steps: options.steps ?? [],
    error: options.error,
    location: options.location,
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    titlePath: () => [options.title ?? "step"],
    annotations: [],
    attachments: [],
  } as unknown as TestStep;
}

export function makeError(message: string, overrides: Partial<TestError> = {}): TestError {
  return {
    message,
    stack: `Error: ${message}\n    at test.step (tests/example.spec.ts:10:5)`,
    ...overrides,
  } as TestError;
}

export function makeAttachment(
  options: Partial<TestResult["attachments"][number]> = {},
): TestResult["attachments"][number] {
  return {
    name: "screenshot",
    contentType: "image/png",
    ...options,
  } as TestResult["attachments"][number];
}
