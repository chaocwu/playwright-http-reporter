import { writeFile } from "node:fs/promises";

// NodeNext needs an ESM-flavoured declaration for the "import" condition.
await writeFile(
  new URL("../dist/index.d.mts", import.meta.url),
  `import { HttpReporter } from "./index.js";
export * from "./index.js";
export default HttpReporter;
`,
);
