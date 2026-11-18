import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

export function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    retry: 0,
    status: "passed",
    duration: 100,
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    errors: [],
    steps: [],
    attachments: [],
    stdout: [],
    stderr: [],
    workerIndex: 0,
    parallelIndex: 0,
    ...overrides,
  } as TestResult;
}

export function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: "test-id",
    title: "example test",
    titlePath: () => ["", "example.spec.ts", "example test"],
    location: { file: "tests/example.spec.ts", line: 3, column: 1 },
    tags: [],
    annotations: [],
    expectedStatus: "passed",
    outcome: () => "expected",
    repeatEachIndex: 0,
    results: [],
    parent: { project: () => ({ name: "chromium" }) },
    ...overrides,
  } as unknown as TestCase;
}

export function makeSuite(tests: TestCase[]): Suite {
  return { allTests: () => tests } as Suite;
}

export function makeConfig(): FullConfig {
  return { version: "1.65.0", rootDir: "/repo" } as FullConfig;
}

export function makeFullResult(
  overrides: Partial<FullResult> = {},
): FullResult {
  return {
    status: "passed",
    startTime: new Date("2026-01-01T00:00:00.000Z"),
    duration: 1_000,
    ...overrides,
  };
}
