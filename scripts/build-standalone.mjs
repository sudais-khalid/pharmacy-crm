// Builds the self-contained server folder used by the desktop app (.next/standalone): the Next.js server,
// its static assets (Next does not copy them), the worker and ops bundles in dist/, and the migrations.
// The bundles keep Prisma external and find it in the folder's own traced node_modules.
import { execSync } from "node:child_process";
import { cpSync, rmSync, existsSync } from "node:fs";

execSync("npx next build", { stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "standalone" } });
execSync("node scripts/build-worker.mjs", { stdio: "inherit" });
rmSync(".next/standalone/.next/static", { recursive: true, force: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
rmSync(".next/standalone/dist", { recursive: true, force: true });
cpSync("dist", ".next/standalone/dist", { recursive: true, filter: (f) => !f.endsWith(".map") });
rmSync(".next/standalone/prisma/migrations", { recursive: true, force: true });
cpSync("prisma/migrations", ".next/standalone/prisma/migrations", { recursive: true });
console.log("standalone server ready in .next/standalone");
