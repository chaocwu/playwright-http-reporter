import { mkdir, writeFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);

await mkdir(new URL("esm/", dist), { recursive: true });
await mkdir(new URL("cjs/", dist), { recursive: true });

await writeFile(new URL("esm/package.json", dist), JSON.stringify({ type: "module" }, null, 2) + "\n");
await writeFile(new URL("cjs/package.json", dist), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
