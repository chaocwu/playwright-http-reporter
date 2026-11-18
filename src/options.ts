export interface HttpReporterOptions {
  /** URL that receives one POST request per event. */
  endpoint: string;
  /** Adds `Authorization: Bearer <token>` unless an authorization header is already set. */
  token?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. Defaults to 10000. */
  timeout?: number;
  /** Retries after the first failed request. Defaults to 2. */
  retries?: number;
  /** Log every upload to stderr. Defaults to false. */
  verbose?: boolean;
}

export interface ResolvedOptions {
  endpoint: string;
  token: string | undefined;
  headers: Record<string, string>;
  timeout: number;
  retries: number;
  verbose: boolean;
}

export function resolveOptions(options: HttpReporterOptions): ResolvedOptions {
  if (
    !options ||
    typeof options.endpoint !== "string" ||
    options.endpoint.trim() === ""
  ) {
    throw new Error("[playwright-http-reporter] 'endpoint' is required");
  }

  let url: URL;
  try {
    url = new URL(options.endpoint);
  } catch {
    throw new Error(
      `[playwright-http-reporter] invalid 'endpoint': ${options.endpoint}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      "[playwright-http-reporter] 'endpoint' must use http or https",
    );
  }

  const timeout = options.timeout ?? 10_000;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      "[playwright-http-reporter] 'timeout' must be greater than 0",
    );
  }

  const retries = options.retries ?? 2;
  if (!Number.isFinite(retries) || retries < 0) {
    throw new Error(
      "[playwright-http-reporter] 'retries' must be a non-negative number",
    );
  }

  return {
    endpoint: options.endpoint,
    token: options.token,
    headers: { ...options.headers },
    timeout,
    retries,
    verbose: options.verbose ?? false,
  };
}
