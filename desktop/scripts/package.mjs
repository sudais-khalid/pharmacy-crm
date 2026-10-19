// Builds the Windows installer: desktop/dist/PharmacyCRM-Setup-<version>.exe (architecture, section 2.3).
// Run `npm run build:desktop` in the repository root first; this packages its .next/standalone folder.
//
//   node scripts/package.mjs            installer (NSIS)
//   node scripts/package.mjs --dir      unpacked app only, for a quick check (dist/win-unpacked)
//
// Code signing (task 2.10) uses CSC_LINK and CSC_KEY_PASSWORD when they are set; without them the build is
// unsigned and Windows SmartScreen warns on first run.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Platform, build } from "electron-builder";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const repo = path.resolve(desktop, "..");
const standalone = path.join(repo, ".next", "standalone");
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
if (!existsSync(path.join(standalone, "server.js")) || !existsSync(path.join(standalone, "dist", "ops-lib.js"))) fail("No server build: run npm run build:desktop in the repository root first.");
if (readdirSync(standalone).some((f) => f.startsWith(".env"))) fail("The server build contains an .env file. Run npm run build:desktop again.");
execFileSync(process.execPath, [path.join(here, "icon.mjs")], { stdio: "inherit" });
if (!existsSync(path.join(desktop, "build", "owner.json"))) execFileSync(process.execPath, [path.join(here, "owner.mjs")], { stdio: "inherit" });

const config = {
  appId: "pk.pharmacycrm.desktop",
  productName: "Pharmacy CRM",
  executableName: "PharmacyCRM",
  copyright: "Copyright 2026 Sudais Khalid",
  directories: { output: "dist", buildResources: "build" },
  extraMetadata: { version },
  files: ["src/**/*", "package.json"],
  asar: true,
  extraResources: [
    { from: standalone, to: "server", filter: ["**/*", "!**/*.map", "!.env*"] },
    // electron-builder never copies a folder named node_modules inside an extra resource, so the server's
    // traced dependencies (Next, Prisma and its query compiler) get an entry of their own
    { from: path.join(standalone, "node_modules"), to: "server/node_modules", filter: ["**/*", "!**/*.map"] },
    // initdb and pg_ctl find share\ and lib\ next to bin\; the wx*.dll files belong to tools not shipped
    { from: path.join(desktop, "node_modules", "@embedded-postgres", "windows-x64", "native"), to: "postgres", filter: ["bin/**", "lib/**", "share/**", "!bin/wx*.dll", "!bin/testplug.dll"] },
    { from: path.join(desktop, "build", "owner.json"), to: "owner.json" },
  ],
  win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "build/icon.png" },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Pharmacy CRM",
    uninstallDisplayName: "Pharmacy CRM",
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    include: "installer/installer.nsh",
    artifactName: "PharmacyCRM-Setup-${version}.${ext}",
  },
  publish: null,
};

const dirOnly = process.argv.includes("--dir");
const result = await build({ projectDir: desktop, targets: Platform.WINDOWS.createTarget(dirOnly ? "dir" : "nsis", 1 /* x64 */), config });
console.log(result.join("\n"));
