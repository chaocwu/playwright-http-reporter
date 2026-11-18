import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const packageName = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
).name;

const output = execFileSync("npm", ["pack", "--silent"], {
  cwd: root,
  encoding: "utf8",
});
const tarball = output.trim().split("\n").at(-1);
if (!tarball) throw new Error("npm pack did not produce a tarball");

const tarballPath = new URL(tarball, root).pathname;
const directory = await mkdtemp(join(tmpdir(), "pw-http-reporter-smoke-"));

try {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "smoke-test", private: true }, null, 2),
  );

  execFileSync(
    "npm",
    [
      "install",
      "--no-save",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      tarballPath,
    ],
    { cwd: directory, stdio: "inherit" },
  );

  execFileSync(
    process.execPath,
    [
      "-e",
      `const mod = require(${JSON.stringify(packageName)});
       if (typeof mod.default !== "function" || typeof mod.HttpReporter !== "function") process.exit(1);
       console.log("CJS smoke test passed");`,
    ],
    { cwd: directory, stdio: "inherit" },
  );

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import Reporter, { HttpReporter } from ${JSON.stringify(packageName)};
       if (Reporter !== HttpReporter) process.exit(1);
       console.log("ESM smoke test passed");`,
    ],
    { cwd: directory, stdio: "inherit" },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
  await rm(tarballPath, { force: true });
}
