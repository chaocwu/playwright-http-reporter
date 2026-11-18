import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { REPORTER_NAME, REPORTER_VERSION } from "./version.js";

export interface FallbackRecord {
  runId: string;
  endpoint: string;
  error: string;
  attempts: number;
  payload: unknown;
}

/** Persists an undelivered payload so it can be inspected or replayed later. */
export async function saveFallback(
  directory: string | undefined,
  record: FallbackRecord,
): Promise<string | undefined> {
  const targetDirectory = directory ?? join(process.cwd(), "test-results");
  const file = join(targetDirectory, `playwright-http-reporter-${record.runId}.json`);

  try {
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify(
        {
          reporter: { name: REPORTER_NAME, version: REPORTER_VERSION },
          createdAt: new Date().toISOString(),
          ...record,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return file;
  } catch (error) {
    console.error(
      `[${REPORTER_NAME}] failed to write fallback payload: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
