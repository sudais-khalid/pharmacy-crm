// Bundles the Node entry points into dist/ (CommonJS, Node 22):
//   src/worker.ts  -> dist/worker.js  (background jobs)
//   src/ops-cli.ts -> dist/ops.js     (migrate, backup, verify, restore)
//   src/ops-lib.ts -> dist/ops-lib.js (the same operations as a library for the desktop supervisor)
// The generated Prisma client stays external: it loads its query compiler (wasm) from node_modules at run
// time. Everything else is bundled, because the desktop server folder only has what Next traced for itself
// (Next bundles @prisma/adapter-pg into its own chunks, so it is not in that node_modules).
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
  external: ["@prisma/client", ".prisma/*", "pg-native"],
  logLevel: "warning",
  define: { __APP_VERSION__: JSON.stringify(version) },
};

await build({ ...common, entryPoints: ["src/worker.ts"], outfile: "dist/worker.js" });
await build({ ...common, entryPoints: ["src/ops-cli.ts"], outfile: "dist/ops.js" });
await build({ ...common, entryPoints: ["src/ops-lib.ts"], outfile: "dist/ops-lib.js" });
console.log("built dist/worker.js, dist/ops.js and dist/ops-lib.js");
