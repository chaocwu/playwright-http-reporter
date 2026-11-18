/** CI metadata extracted from well-known environment variables. Never includes secrets. */
export interface CiInfo {
  isCI: boolean;
  provider?: string;
  buildId?: string;
  jobId?: string;
  jobName?: string;
  workflow?: string;
  commit?: string;
  branch?: string;
  tag?: string;
  pullRequest?: string | number;
  repository?: string;
  url?: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

function pullRequestFromRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return /\/pull\/(\d+)(?:\/|$)/.exec(ref)?.[1];
}

function github(): CiInfo {
  const repository = env("GITHUB_REPOSITORY");
  const runId = env("GITHUB_RUN_ID");
  const serverUrl = env("GITHUB_SERVER_URL") ?? "https://github.com";
  const headRef = env("GITHUB_HEAD_REF");
  const refName = env("GITHUB_REF_NAME");
  const isTag = env("GITHUB_REF_TYPE") === "tag";

  return {
    isCI: true,
    provider: "github",
    buildId: runId,
    jobId: env("GITHUB_JOB"),
    jobName: env("GITHUB_JOB"),
    workflow: env("GITHUB_WORKFLOW"),
    commit: env("GITHUB_SHA"),
    branch: headRef ?? (isTag ? undefined : refName),
    tag: isTag ? refName : undefined,
    pullRequest: pullRequestFromRef(env("GITHUB_REF")),
    repository,
    url: repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : undefined,
  };
}

function gitlab(): CiInfo {
  return {
    isCI: true,
    provider: "gitlab",
    buildId: env("CI_PIPELINE_ID"),
    jobId: env("CI_JOB_ID"),
    jobName: env("CI_JOB_NAME"),
    workflow: env("CI_PIPELINE_SOURCE"),
    commit: env("CI_COMMIT_SHA"),
    branch: env("CI_COMMIT_TAG") ? undefined : env("CI_COMMIT_REF_NAME"),
    tag: env("CI_COMMIT_TAG"),
    pullRequest: env("CI_MERGE_REQUEST_IID"),
    repository: env("CI_PROJECT_PATH"),
    url: env("CI_PIPELINE_URL"),
  };
}

function circleci(): CiInfo {
  const repository = env("CIRCLE_PROJECT_REPONAME");
  const buildId = env("CIRCLE_BUILD_NUM");
  return {
    isCI: true,
    provider: "circleci",
    buildId,
    jobId: env("CIRCLE_WORKFLOW_JOB_ID"),
    jobName: env("CIRCLE_JOB"),
    workflow: env("CIRCLE_WORKFLOW_ID"),
    commit: env("CIRCLE_SHA1"),
    branch: env("CIRCLE_BRANCH"),
    tag: env("CIRCLE_TAG"),
    pullRequest: pullRequestFromRef(env("CIRCLE_PULL_REQUEST")),
    repository,
    url:
      repository && buildId
        ? `https://app.circleci.com/pipelines/github/${env("CIRCLE_PROJECT_USERNAME")}/${repository}/${buildId}`
        : undefined,
  };
}

function jenkins(): CiInfo {
  return {
    isCI: true,
    provider: "jenkins",
    buildId: env("BUILD_ID"),
    jobId: env("BUILD_TAG"),
    jobName: env("JOB_NAME"),
    commit: env("GIT_COMMIT"),
    branch: env("GIT_BRANCH"),
    tag: env("GIT_TAG_NAME"),
    pullRequest: env("CHANGE_ID"),
    url: env("BUILD_URL"),
  };
}

function azure(): CiInfo {
  const ref = env("BUILD_SOURCEBRANCH");
  const buildId = env("BUILD_BUILDID");
  return {
    isCI: true,
    provider: "azure-pipelines",
    buildId,
    jobId: env("SYSTEM_JOBID"),
    jobName: env("SYSTEM_JOBDISPLAYNAME"),
    workflow: env("BUILD_DEFINITIONNAME"),
    commit: env("BUILD_SOURCEVERSION"),
    branch: ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : undefined,
    tag: ref?.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : undefined,
    pullRequest: env("SYSTEM_PULLREQUEST_PULLREQUESTID"),
    repository: env("BUILD_REPOSITORY_NAME"),
    url: buildId ? `${env("SYSTEM_TEAMFOUNDATIONCOLLECTIONURI") ?? ""}${env("SYSTEM_TEAMPROJECT") ?? ""}/_build/results?buildId=${buildId}` : undefined,
  };
}

function bitbucket(): CiInfo {
  const repository = env("BITBUCKET_REPO_FULL_NAME");
  const buildId = env("BITBUCKET_BUILD_NUMBER");
  return {
    isCI: true,
    provider: "bitbucket",
    buildId,
    commit: env("BITBUCKET_COMMIT"),
    branch: env("BITBUCKET_BRANCH"),
    tag: env("BITBUCKET_TAG"),
    pullRequest: env("BITBUCKET_PR_ID"),
    repository,
    url: repository && buildId ? `https://bitbucket.org/${repository}/pipelines/results/${buildId}` : undefined,
  };
}

/** Detects the CI provider from environment variables. */
export function detectCi(): CiInfo {
  if (env("GITHUB_ACTIONS") === "true") return github();
  if (env("GITLAB_CI") === "true") return gitlab();
  if (env("CIRCLECI") === "true") return circleci();
  if (env("JENKINS_URL")) return jenkins();
  if (env("TF_BUILD") === "true") return azure();
  if (env("BITBUCKET_BUILD_NUMBER")) return bitbucket();

  return { isCI: env("CI") !== undefined };
}
