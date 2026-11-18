import { describe, expect, it } from "vitest";

import { resolveOptions } from "../src/options.js";

describe("resolveOptions", () => {
  it("fills in defaults", () => {
    const options = resolveOptions({ endpoint: "https://ci.example.com/report" });

    expect(options.method).toBe("POST");
    expect(options.timeout).toBe(15_000);
    expect(options.retries).toBe(2);
    expect(options.retryDelay).toBe(500);
    expect(options.includeSteps).toBe(true);
    expect(options.includeAttachments).toBe(false);
    expect(options.includeStdout).toBe(false);
    expect(options.onlyOnFailure).toBe(false);
    expect(options.failOnError).toBe(false);
    expect(options.gzip).toBe(false);
    expect(options.verbose).toBe(false);
    expect(typeof options.fetch).toBe("function");
  });

  it("keeps explicit values and copies mutable objects", () => {
    const headers = { "x-custom": "1" };
    const metadata = { env: "staging" };
    const options = resolveOptions({
      endpoint: "http://localhost:8787/report",
      method: "PUT",
      token: "secret",
      headers,
      metadata,
      timeout: 1_000,
      retries: 0,
      retryDelay: 0,
      includeAttachments: true,
      maxAttachmentSize: 10,
      includeStdout: true,
      includeSteps: false,
      maxErrorLength: 0,
      maxOutputLength: 0,
      onlyOnFailure: true,
      failOnError: true,
      gzip: true,
      verbose: true,
    });

    expect(options.method).toBe("PUT");
    expect(options.token).toBe("secret");
    expect(options.headers).toEqual(headers);
    expect(options.headers).not.toBe(headers);
    expect(options.metadata).toEqual(metadata);
    expect(options.metadata).not.toBe(metadata);
    expect(options.includeSteps).toBe(false);
    expect(options.gzip).toBe(true);
  });

  it.each([
    [{ endpoint: "" }, "missing required option 'endpoint'"],
    [{ endpoint: "not a url" }, "not a valid URL"],
    [{ endpoint: "ftp://example.com" }, "must use http or https"],
    [{ endpoint: "https://example.com", timeout: 0 }, "greater than 0"],
    [{ endpoint: "https://example.com", retries: -1 }, "non-negative"],
    [{ endpoint: "https://example.com", retryDelay: Number.NaN }, "non-negative"],
    [{ endpoint: "https://example.com", method: "DELETE" }, "must be one of"],
    [{ endpoint: "https://example.com", maxAttachmentSize: -5 }, "non-negative"],
  ])("rejects invalid options %j", (input, message) => {
    expect(() => resolveOptions(input as never)).toThrow(message);
  });

  it("rejects missing options", () => {
    expect(() => resolveOptions(undefined as never)).toThrow("options are required");
  });
});
