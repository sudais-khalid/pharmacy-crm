// Installs, uninstalls and reinstalls the real installer (dist/PharmacyCRM-Setup-<version>.exe) silently for
// the current Windows user and checks the data survives (Phase 2 acceptance criteria). The data folder is a
// throwaway one (PCRM_DATA_DIR), never %PROGRAMDATA%. The app is uninstalled again at the end.
//
//   node scripts/installer-test.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setup = readdirSync(path.join(desktop, "dist")).find((f) => /^PharmacyCRM-Setup-.*\.exe$/.test(f));
if (!setup) throw new Error("No installer in dist: run npm run package first.");
const installer = path.join(desktop, "dist", setup);
const root = mkdtempSync(path.join(tmpdir(), "pcrm-install-"));
const dataDir = path.join(root, "PharmacyCRM");
const instDir = path.join(process.env.LOCALAPPDATA, "Programs", "PharmacyCRM");
const exe = path.join(instDir, "PharmacyCRM.exe");
const uninstaller = path.join(instDir, "Uninstall PharmacyCRM.exe");
const env = { ...process.env, PCRM_DATA_DIR: dataDir, PLATFORM_OWNER_EMAIL: "owner@selftest.example", PLATFORM_OWNER_PASSWORD: "Selftest-Owner-2026" };
delete env.ELECTRON_RUN_AS_NODE;
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) failures++;
}

const install = () => spawnSync(installer, ["/S"], { env, stdio: "ignore", timeout: 300_000 }).status;
// _?= keeps the uninstaller in place so this waits for it to finish
const uninstall = (...flags) => spawnSync(uninstaller, ["/currentuser", "/S", ...flags, `_?=${instDir}`], { env, stdio: "ignore", timeout: 180_000 }).status;

function runApp(extra = {}) {
  return new Promise((resolve) => {
    const p = spawn(exe, ["--selftest"], { env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => {
      const file = path.join(dataDir, "logs", "selftest.json");
      const report = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
      rmSync(file, { force: true });
      resolve({ code, report, out });
    });
  });
}

try {
  check("the installer runs silently", install() === 0 && existsSync(exe), instDir);
  const first = await runApp();
  check("the installed app starts and makes its database", first.code === 0 && first.report?.ok && first.report.events.includes("database-created"), first.out.slice(-1500));

  check("uninstalling keeps the pharmacy data", uninstall() === 0 && existsSync(path.join(dataDir, "data", "PG_VERSION")) && existsSync(path.join(dataDir, "keys.json")));
  check("the program is removed", !existsSync(exe));
  install();
  const second = await runApp();
  check("after reinstalling every record is still there", second.code === 0 && second.report?.auditMarkers === first.report.auditMarkers + 1 && !second.report.events.includes("database-created"), second.out.slice(-1500));
  const recoveryKey = second.report?.recoveryKey;

  check("uninstalling with /DELETEDATA deletes the data and keeps the backups", uninstall("/DELETEDATA") === 0 && !existsSync(path.join(dataDir, "data")) && !existsSync(path.join(dataDir, "keys.json")) && readdirSync(path.join(dataDir, "backups")).length > 0);
  install();
  const third = await runApp({ PCRM_SELFTEST_FIRST_START: "latest", PCRM_SELFTEST_RECOVERY_KEY: recoveryKey });
  check("a reinstall restores everything from the backups with the recovery key", third.code === 0 && third.report?.events.includes("restored") && third.report.auditMarkers === second.report.auditMarkers + 1, third.out.slice(-1500));

  check("uninstalling with /DELETEDATA /DELETEBACKUPS removes the whole data folder", uninstall("/DELETEDATA", "/DELETEBACKUPS") === 0 && !existsSync(dataDir));
} finally {
  // through the uninstaller, so its registry entry and shortcuts go too
  if (existsSync(uninstaller)) uninstall();
  rmSync(instDir, { recursive: true, force: true }); // what _?= leaves behind: the uninstaller itself
  rmSync(path.join(process.env.APPDATA, "Pharmacy CRM"), { recursive: true, force: true });
  if (failures) console.log(`kept ${root} for inspection`);
  else rmSync(root, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : "all installer checks passed");
process.exit(failures ? 1 : 0);
