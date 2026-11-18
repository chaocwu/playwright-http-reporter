import { setTimeout as sleep } from "node:timers/promises";

import type { ResolvedOptions } from "./options.js";

export type ReporterEventName = "begin" | "testEnd" | "error" | "end";

export interface ReporterEvent {
  runId: string;
  event: ReporterEventName;
  timestamp: string;
  data: unknown;
}

/** JSON-encodes an event, dropping functions and marking circular references. */
export function serializeEvent(event: ReporterEvent): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(event, (_key, value) => {
    if (typeof value === "function") return undefined;
    if (typeof value === "bigint") return value.toString();
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

export interface PostEventOptions extends ResolvedOptions {
  fetch?: typeof globalThis.fetch;
}

function buildHeaders(options: PostEventOptions): Record<string, string> {
  const headers = new Map<string, { name: string; value: string }>();
  const set = (name: string, value: string): void => {
    headers.set(name.toLowerCase(), { name, value });
  };

  set("Content-Type", "application/json");
  set("Accept", "application/json");
  set("User-Agent", "@chaocw/playwright-http-reporter");

  for (const [name, value] of Object.entries(options.headers)) set(name, value);
  if (options.token && !headers.has("authorization")) {
    set("Authorization", `Bearer ${options.token}`);
  }

  return Object.fromEntries(Array.from(headers.values(), ({ name, value }) => [name, value]));
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Sends one event, retrying network errors and retryable HTTP statuses. */
export async function postEvent(event: ReporterEvent, options: PostEventOptions): Promise<void> {
  const body = serializeEvent(event);
  const headers = buildHeaders(options);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const maxAttempts = Math.floor(options.retries) + 1;
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      if (response.ok) return;

      const text = await response.text().catch(() => "");
      lastError = `HTTP ${response.status}${text ? `: ${text.slice(0, 500)}` : ""}`;
      if (!isRetryable(response.status)) break;
    } catch (error) {
      lastError = controller.signal.aborted
        ? `timed out after ${options.timeout}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) {
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw new Error(lastError);
}
