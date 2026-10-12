// Builds the self-contained Next.js server used by the desktop app (.next/standalone) and the worker bundle.
// Next does not copy static assets into the standalone folder, so this script does.
import { execSync } from "node:child_process";
import { cpSync, rmSync, existsSync } from "node:fs";

execSync("npx next build", { stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "standalone" } });
execSync("node scripts/build-worker.mjs", { stdio: "inherit" });
rmSync(".next/standalone/.next/static", { recursive: true, force: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
console.log("standalone server ready in .next/standalone");
