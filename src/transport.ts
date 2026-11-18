import { setTimeout as sleep } from "node:timers/promises";
import { gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";

import type { FetchLike } from "./options.js";
import { REPORTER_NAME, REPORTER_VERSION } from "./version.js";

const gzip = promisify(gzipCallback);
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_ERROR_BODY_LENGTH = 1_000;

export interface SendReportOptions {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  token?: string | undefined;
  headers: Record<string, string>;
  timeout: number;
  retries: number;
  retryDelay: number;
  gzip: boolean;
  fetch: FetchLike;
  runId: string;
  verbose: boolean;
  log: (message: string) => void;
}

export interface SendReportResult {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

function buildHeaders(options: SendReportOptions): Record<string, string> {
  const headers = new Map<string, { name: string; value: string }>();
  const set = (name: string, value: string): void => {
    headers.set(name.toLowerCase(), { name, value });
  };

  set("Content-Type", "application/json");
  set("Accept", "application/json");
  set("User-Agent", `${REPORTER_NAME}/${REPORTER_VERSION}`);
  set("X-Playwright-Run-Id", options.runId);

  for (const [name, value] of Object.entries(options.headers)) {
    if (typeof value === "string") set(name, value);
  }

  if (options.token && !headers.has("authorization")) {
    set("Authorization", `Bearer ${options.token}`);
  }
  if (options.gzip) set("Content-Encoding", "gzip");

  return Object.fromEntries(Array.from(headers.values(), ({ name, value }) => [name, value]));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return undefined;
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > MAX_ERROR_BODY_LENGTH
      ? `${text.slice(0, MAX_ERROR_BODY_LENGTH)}... [truncated]`
      : text;
  } catch {
    return "";
  }
}

/** Serializes and uploads the report with timeout and retry handling. */
export async function sendReport(
  payload: unknown,
  options: SendReportOptions,
): Promise<SendReportResult> {
  let body: BodyInit;
  try {
    const json = JSON.stringify(payload);
    if (typeof json !== "string") {
      throw new Error("payload is not JSON serializable");
    }
    body = options.gzip ? (new Uint8Array(await gzip(Buffer.from(json, "utf8"))) as BodyInit) : json;
  } catch (error) {
    return {
      ok: false,
      attempts: 0,
      error: `failed to serialize payload: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const headers = buildHeaders(options);
  const maxAttempts = Math.max(1, Math.floor(options.retries) + 1);
  let attempts = 0;
  let lastError = "unknown error";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout);
    let retryAfterMs: number | undefined;

    try {
      if (options.verbose) {
        options.log(`uploading to ${options.url} (attempt ${attempt}/${maxAttempts})`);
      }

      const response = await options.fetch(options.url, {
        method: options.method,
        headers,
        body,
        signal: controller.signal,
      });
      lastStatus = response.status;

      if (response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // The body is irrelevant for successful responses.
        }
        return { ok: true, attempts, status: response.status };
      }

      const responseBody = await readResponseBody(response);
      lastError = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${responseBody ? `: ${responseBody}` : ""}`;

      if (!isRetryableStatus(response.status)) break;
      retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    } catch (error) {
      lastError = controller.signal.aborted
        ? `request timed out after ${options.timeout}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    } finally {
      clearTimeout(timer);
    }

    if (attempt === maxAttempts) break;

    let delayMs = options.retryDelay * 2 ** (attempt - 1);
    if (retryAfterMs !== undefined) {
      delayMs = Math.max(delayMs, Math.min(retryAfterMs, MAX_RETRY_AFTER_MS));
    }

    if (options.verbose) {
      options.log(`attempt ${attempt} failed: ${lastError}; retrying in ${delayMs}ms`);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  return { ok: false, attempts, error: lastError, status: lastStatus };
}
