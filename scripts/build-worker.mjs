// Bundles src/worker.ts into dist/worker.js (CommonJS, Node 22).
// Prisma stays external: it loads its generated client and query compiler from node_modules at run time.
import { build } from "esbuild";

await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  external: ["@prisma/client", "@prisma/adapter-pg", ".prisma/*", "pg-native"],
  logLevel: "warning",
});
console.log("built dist/worker.js");
