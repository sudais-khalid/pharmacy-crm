// Builds the self-contained server folder used by the desktop app (.next/standalone): the Next.js server,
// its static assets (Next does not copy them), the worker and ops bundles in dist/, and the migrations.
// The bundles keep Prisma external and find it in the folder's own traced node_modules.
import { execSync } from "node:child_process";
import { cpSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

execSync("npx next build", { stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "standalone" } });
execSync("node scripts/build-worker.mjs", { stdio: "inherit" });
// Next copies .env files into the standalone folder and its server loads them at start. They hold local
// development secrets and must never reach an installer: the desktop supervisor provides every setting.
for (const f of readdirSync(".next/standalone")) if (f.startsWith(".env")) rmSync(`.next/standalone/${f}`, { force: true });
const leftover = readdirSync(".next/standalone").filter((f) => f.startsWith(".env"));
if (leftover.length) throw new Error(`refusing to continue: ${leftover.join(", ")} still in .next/standalone`);
rmSync(".next/standalone/.next/static", { recursive: true, force: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
rmSync(".next/standalone/dist", { recursive: true, force: true });
cpSync("dist", ".next/standalone/dist", { recursive: true, filter: (f) => !f.endsWith(".map") });
rmSync(".next/standalone/prisma/migrations", { recursive: true, force: true });
cpSync("prisma/migrations", ".next/standalone/prisma/migrations", { recursive: true });
// The local photo reader is loaded at run time (src/modules/stockentry/ocr/local.ts), so Next cannot trace it:
// copy Tesseract, its English model and their dependencies into the server's node_modules.
const copied = new Set();
function copyPackage(name, from = ".") {
  if (copied.has(name)) return;
  let dir = path.resolve(from, "node_modules", name);
  while (!existsSync(path.join(dir, "package.json"))) {
    const up = path.resolve(from, "..");
    if (up === path.resolve(from)) throw new Error(`package ${name} is not installed`);
    from = up;
    dir = path.resolve(from, "node_modules", name);
  }
  copied.add(name);
  cpSync(dir, path.join(".next/standalone/node_modules", name), { recursive: true, dereference: true, filter: (f) => !/[\\/](test|tests|docs|examples)$/.test(f) && !/[\\/]eng[\\/]4\.0\.0$/.test(f) &&!f.endsWith(".map") && !f.endsWith(".md") });
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) if (dep !== "opencollective-postinstall") copyPackage(dep, dir);
}
copyPackage("tesseract.js");
copyPackage("@tesseract.js-data/eng");
console.log(`copied the photo reader (${copied.size} packages)`);
console.log("standalone server ready in .next/standalone");
