import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectCi } from "../src/ci.js";

const CI_ENV_KEYS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_RUN_ID",
  "GITHUB_JOB",
  "GITHUB_WORKFLOW",
  "GITHUB_SHA",
  "GITHUB_REF_NAME",
  "GITHUB_REF_TYPE",
  "GITHUB_REF",
  "GITHUB_HEAD_REF",
  "GITHUB_REPOSITORY",
  "GITHUB_SERVER_URL",
  "GITHUB_TOKEN",
  "GITLAB_CI",
  "CI_PIPELINE_ID",
  "CI_JOB_ID",
  "CI_JOB_NAME",
  "CI_COMMIT_SHA",
  "CI_COMMIT_REF_NAME",
  "CI_COMMIT_TAG",
  "CI_PROJECT_PATH",
];

beforeEach(() => {
  for (const key of CI_ENV_KEYS) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("detectCi", () => {
  it("reports a non-CI environment", () => {
    expect(detectCi()).toEqual({ isCI: false });
  });

  it("detects GitHub Actions on a branch", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("GITHUB_RUN_ID", "12345");
    vi.stubEnv("GITHUB_JOB", "test");
    vi.stubEnv("GITHUB_WORKFLOW", "CI");
    vi.stubEnv("GITHUB_SHA", "abc123");
    vi.stubEnv("GITHUB_REF_NAME", "main");
    vi.stubEnv("GITHUB_REF_TYPE", "branch");
    vi.stubEnv("GITHUB_REPOSITORY", "chaocwu/playwright-http-reporter");
    vi.stubEnv("GITHUB_SERVER_URL", "https://github.com");
    vi.stubEnv("GITHUB_TOKEN", "super-secret");

    const ci = detectCi();

    expect(ci).toMatchObject({
      isCI: true,
      provider: "github",
      buildId: "12345",
      jobId: "test",
      jobName: "test",
      workflow: "CI",
      commit: "abc123",
      branch: "main",
      repository: "chaocwu/playwright-http-reporter",
      url: "https://github.com/chaocwu/playwright-http-reporter/actions/runs/12345",
    });
    expect(ci.tag).toBeUndefined();
    expect(JSON.stringify(ci)).not.toContain("super-secret");
  });

  it("detects GitHub pull requests and tags", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("GITHUB_REF", "refs/pull/77/merge");
    vi.stubEnv("GITHUB_HEAD_REF", "feature/reporting");
    vi.stubEnv("GITHUB_REF_NAME", "77/merge");
    vi.stubEnv("GITHUB_REF_TYPE", "branch");

    expect(detectCi()).toMatchObject({
      provider: "github",
      branch: "feature/reporting",
      pullRequest: "77",
    });

    vi.stubEnv("GITHUB_REF", "refs/tags/v0.1.0");
    vi.stubEnv("GITHUB_REF_NAME", "v0.1.0");
    vi.stubEnv("GITHUB_REF_TYPE", "tag");
    vi.stubEnv("GITHUB_HEAD_REF", "");

    expect(detectCi()).toMatchObject({
      provider: "github",
      tag: "v0.1.0",
    });
    expect(detectCi().branch).toBeUndefined();
  });

  it("detects GitLab CI", () => {
    vi.stubEnv("GITLAB_CI", "true");
    vi.stubEnv("CI_PIPELINE_ID", "900");
    vi.stubEnv("CI_JOB_ID", "901");
    vi.stubEnv("CI_JOB_NAME", "test");
    vi.stubEnv("CI_COMMIT_SHA", "def456");
    vi.stubEnv("CI_COMMIT_REF_NAME", "main");
    vi.stubEnv("CI_PROJECT_PATH", "chaocw/reporter");

    expect(detectCi()).toMatchObject({
      isCI: true,
      provider: "gitlab",
      buildId: "900",
      jobId: "901",
      jobName: "test",
      commit: "def456",
      branch: "main",
      repository: "chaocw/reporter",
    });
  });

  it("falls back to a generic CI flag", () => {
    vi.stubEnv("CI", "true");
    expect(detectCi()).toEqual({ isCI: true });
  });
});
