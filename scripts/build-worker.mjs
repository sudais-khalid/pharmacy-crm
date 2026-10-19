// Bundles the Node entry points into dist/ (CommonJS, Node 22):
//   src/worker.ts  -> dist/worker.js  (background jobs)
//   src/ops-cli.ts -> dist/ops.js     (migrate, backup, verify, restore)
//   src/ops-lib.ts -> dist/ops-lib.js (the same operations as a library for the desktop supervisor)
// Prisma stays external: it loads its generated client and query compiler from node_modules at run time.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  external: ["@prisma/client", "@prisma/adapter-pg", ".prisma/*", "pg-native"],
  logLevel: "warning",
  define: { __APP_VERSION__: JSON.stringify(version) },
};

await build({ ...common, entryPoints: ["src/worker.ts"], outfile: "dist/worker.js" });
// recover-owner loads the identity module, whose session helpers import next/headers (never called here);
// Next stays external and comes from the same node_modules as the server
await build({ ...common, entryPoints: ["src/ops-cli.ts"], outfile: "dist/ops.js", external: [...common.external, "next", "next/*"] });
await build({ ...common, entryPoints: ["src/ops-lib.ts"], outfile: "dist/ops-lib.js" });
console.log("built dist/worker.js, dist/ops.js and dist/ops-lib.js");
