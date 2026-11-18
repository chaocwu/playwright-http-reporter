import type { ReportPayload } from "./payload.js";

/** Minimal fetch signature so tests and proxies can inject their own implementation. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Configuration accepted by {@link HttpReporter}. */
export interface HttpReporterOptions {
  /** HTTP endpoint that receives the report. Required. */
  endpoint: string;
  /** HTTP method used for the upload. Defaults to `POST`. */
  method?: "POST" | "PUT" | "PATCH";
  /** Bearer token. Adds `Authorization: Bearer <token>` unless a header is provided. */
  token?: string;
  /** Additional request headers. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. Defaults to 15000. */
  timeout?: number;
  /** Retry attempts after the first failed request. Defaults to 2. */
  retries?: number;
  /** Base delay for exponential backoff in milliseconds. Defaults to 500. */
  retryDelay?: number;
  /** Only upload when the run has failures, flaky tests, or reporter errors. */
  onlyOnFailure?: boolean;
  /** Throw from `onEnd` when the upload fails. Defaults to false. */
  failOnError?: boolean;
  /** Include attachment bodies as base64. Defaults to false (metadata only). */
  includeAttachments?: boolean;
  /** Maximum attachment size in bytes to inline. Defaults to 1048576. */
  maxAttachmentSize?: number;
  /** Include test stdout and stderr. Defaults to false. */
  includeStdout?: boolean;
  /** Include test steps. Defaults to true. */
  includeSteps?: boolean;
  /** Maximum characters per error message/stack. Defaults to 65536. 0 disables truncation. */
  maxErrorLength?: number;
  /** Maximum characters for stdout/stderr per attempt. Defaults to 32768. 0 disables truncation. */
  maxOutputLength?: number;
  /** Custom metadata stored on the run object. */
  metadata?: Record<string, unknown>;
  /** Mutate or redact the payload before it is sent. */
  transformPayload?: (payload: ReportPayload) => ReportPayload | Promise<ReportPayload>;
  /** Directory for undelivered payloads. Defaults to `./test-results`. */
  fallbackDir?: string;
  /** Log upload progress to stderr. Defaults to false. */
  verbose?: boolean;
  /** Gzip the request body. Defaults to false. */
  gzip?: boolean;
  /** Custom fetch implementation. Defaults to the global fetch. */
  fetch?: FetchLike;
}

/** Options after defaults and validation have been applied. */
export interface ResolvedOptions {
  endpoint: string;
  method: "POST" | "PUT" | "PATCH";
  token: string | undefined;
  headers: Record<string, string>;
  timeout: number;
  retries: number;
  retryDelay: number;
  onlyOnFailure: boolean;
  failOnError: boolean;
  includeAttachments: boolean;
  maxAttachmentSize: number;
  includeStdout: boolean;
  includeSteps: boolean;
  maxErrorLength: number;
  maxOutputLength: number;
  metadata: Record<string, unknown> | undefined;
  transformPayload: ((payload: ReportPayload) => ReportPayload | Promise<ReportPayload>) | undefined;
  fallbackDir: string | undefined;
  verbose: boolean;
  gzip: boolean;
  fetch: FetchLike;
}

function fail(message: string): never {
  throw new Error(`[playwright-http-reporter] ${message}`);
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    fail(`'${name}' must be a non-negative number`);
  }
  return value;
}

/** Validates user options and fills in defaults. */
export function resolveOptions(options: HttpReporterOptions): ResolvedOptions {
  if (!options || typeof options !== "object") {
    fail("options are required, e.g. { endpoint: 'https://example.com/report' }");
  }
  if (typeof options.endpoint !== "string" || options.endpoint.trim() === "") {
    fail("missing required option 'endpoint'");
  }

  let url: URL;
  try {
    url = new URL(options.endpoint);
  } catch {
    fail(`'endpoint' is not a valid URL: ${options.endpoint}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail("'endpoint' must use http or https");
  }

  const method = options.method ?? "POST";
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") {
    fail("'method' must be one of POST, PUT or PATCH");
  }

  const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (typeof fetchImpl !== "function") {
    fail("global fetch is not available; Node.js 18 or newer is required");
  }

  const timeout = options.timeout ?? 15_000;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    fail("'timeout' must be greater than 0");
  }

  return {
    endpoint: options.endpoint,
    method,
    token: options.token,
    headers: { ...options.headers },
    timeout,
    retries: nonNegative(options.retries ?? 2, "retries"),
    retryDelay: nonNegative(options.retryDelay ?? 500, "retryDelay"),
    onlyOnFailure: options.onlyOnFailure ?? false,
    failOnError: options.failOnError ?? false,
    includeAttachments: options.includeAttachments ?? false,
    maxAttachmentSize: nonNegative(options.maxAttachmentSize ?? 1_048_576, "maxAttachmentSize"),
    includeStdout: options.includeStdout ?? false,
    includeSteps: options.includeSteps ?? true,
    maxErrorLength: nonNegative(options.maxErrorLength ?? 65_536, "maxErrorLength"),
    maxOutputLength: nonNegative(options.maxOutputLength ?? 32_768, "maxOutputLength"),
    metadata: options.metadata ? { ...options.metadata } : undefined,
    transformPayload: options.transformPayload,
    fallbackDir: options.fallbackDir,
    verbose: options.verbose ?? false,
    gzip: options.gzip ?? false,
    fetch: fetchImpl,
  };
}
