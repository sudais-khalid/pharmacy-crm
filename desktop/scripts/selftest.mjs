// End-to-end check of the desktop supervisor against a throwaway data folder (never %PROGRAMDATA%).
// Needs `npm run build:desktop` in the repository root first.
//
//   node scripts/selftest.mjs                                      the app from source
//   node scripts/selftest.mjs --exe dist/win-unpacked/PharmacyCRM.exe   a packaged build (skips the checks
//                                                                  that need a test migrations folder)
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const repo = path.resolve(desktop, "..");
const electron = createRequire(import.meta.url)("electron");
const pgBin = path.join(desktop, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const root = mkdtempSync(path.join(tmpdir(), "pcrm-desktop-"));
const dataDir = path.join(root, "PharmacyCRM");
const exeArg = process.argv.indexOf("--exe");
const exe = exeArg > 0 ? path.resolve(process.argv[exeArg + 1]) : null;
// one test Developer for every run, so a build's owner.json is never used here
const owner = { PLATFORM_OWNER_EMAIL: "owner@selftest.example", PLATFORM_OWNER_PASSWORD: "Selftest-Owner-2026" };
let migrations = null;
const withMigrations = () => (migrations ? { PCRM_MIGRATIONS_DIR: migrations } : {});
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) failures++;
}

function runApp(extraEnv = {}, args = []) {
  const env = { ...process.env, PCRM_DATA_DIR: dataDir, ...owner, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const started = Date.now();
    const p = exe ? spawn(exe, ["--selftest", ...args], { env, stdio: ["ignore", "pipe", "pipe"] }) : spawn(electron, [desktop, "--selftest", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => {
      const file = path.join(dataDir, "logs", "selftest.json");
      const report = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
      rmSync(file, { force: true });
      resolve({ code, report, out, seconds: Math.round((Date.now() - started) / 100) / 10 });
    });
  });
}

const pgRunning = () => {
  try {
    execFileSync(path.join(pgBin, "pg_ctl.exe"), ["status", "-D", path.join(dataDir, "data")], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

try {
  // 1. first start on an empty PC
  const first = await runApp();
  check("first start succeeds", first.code === 0 && first.report?.ok, first.out.slice(-1500));
  console.log(`      first start took ${first.seconds}s`);
  check("first start creates the database and the backup key", ["database-created", "backup-key-created"].every((e) => first.report?.events.includes(e)), JSON.stringify(first.report?.events));
  check("PostgreSQL listens on loopback only", first.report?.listenAddresses === "127.0.0.1", first.report?.listenAddresses);
  check("PostgreSQL is stopped after quitting", !pgRunning());
  const keys = JSON.parse(readFileSync(path.join(dataDir, "keys.json"), "utf8"));
  // Electron safeStorage output on Windows: "v10" followed by AES-GCM data under a DPAPI-protected key
  const sealed = ["dbPassword", "backupKey", "jwtSecret", "totpKey"].map((k) => Buffer.from(keys.secrets[k] ?? "", "base64"));
  check("secrets are stored DPAPI-protected", sealed.every((b) => b.subarray(0, 3).toString() === "v10" && b.length > 30), sealed.map((b) => b.subarray(0, 8).toString("hex")).join(" "));
  const config = JSON.parse(readFileSync(path.join(dataDir, "config.json"), "utf8"));
  check("ports are stored for the installation", config.pgPort > 0 && config.webPort > 0, JSON.stringify(config));
  const firstBackups = readdirSync(path.join(dataDir, "backups"));
  check("a first snapshot is taken at start and another on close", firstBackups.some((f) => f.endsWith("-scheduled.pcrmbak")) && firstBackups.some((f) => f.endsWith("-on-close.pcrmbak")), firstBackups.join(" "));
  check("the last backup is recorded", config.lastBackup?.reason === "on-close" && config.lastBackup.size > 0 && !config.lastBackupError, JSON.stringify(config.lastBackup));
  check("the recovery key is still waiting to be shown", config.recoveryKeyShown === false);
  const acl = execFileSync("icacls", [dataDir], { encoding: "utf8" });
  check("data folder is not open to other users", !/(Everyone|Users|Authenticated Users):/i.test(acl) && /S-1-5-18|SYSTEM/i.test(acl), acl);

  // 2. restart keeps the data and the ports; backups are also copied to a mirror folder
  const mirror = path.join(root, "usb", "PharmacyCRM backups");
  writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ ...config, mirrorDir: mirror }, null, 2));
  const second = await runApp();
  check("snapshots are copied to the mirror folder", existsSync(mirror) && readdirSync(mirror).some((f) => f.endsWith("-on-close.pcrmbak")), existsSync(mirror) ? readdirSync(mirror).join(" ") : "no mirror folder");
  check("restart succeeds and keeps data", second.code === 0 && second.report?.selftestRuns === 2 && !second.report.events.includes("database-created"), JSON.stringify(second.report));
  check("restart uses the same ports", second.report?.pgPort === config.pgPort && second.report?.baseUrl.endsWith(`:${config.webPort}`));

  // 3. the database password is lost (another Windows account, profile reset)
  delete keys.secrets.dbPassword;
  writeFileSync(path.join(dataDir, "keys.json"), JSON.stringify(keys, null, 2));
  const third = await runApp();
  check("a lost database password is reset locally", third.code === 0 && third.report?.events.includes("database-password-reset") && third.report.selftestRuns === 3, third.out.slice(-1500));
  check("no temporary trust rules are left behind", !existsSync(path.join(dataDir, "data", "pcrm_reset_hba.conf")));

  // 4. PostgreSQL left running by a crashed session
  execFileSync(path.join(pgBin, "pg_ctl.exe"), ["start", "-w", "-D", path.join(dataDir, "data"), "-o", `-p ${config.pgPort} -c listen_addresses=127.0.0.1`, "-l", path.join(root, "orphan.log")], { stdio: "ignore" });
  const fourth = await runApp();
  check("a PostgreSQL left running is taken over", fourth.code === 0 && fourth.report?.selftestRuns === 4, fourth.out.slice(-1500));

  if (!exe) {
    // 5. an update with a new migration backs up first
    migrations = path.join(root, "migrations");
    cpSync(path.join(repo, "prisma", "migrations"), migrations, { recursive: true });
    mkdirSync(path.join(migrations, "29990101000000_selftest"));
    writeFileSync(path.join(migrations, "29990101000000_selftest", "migration.sql"), "SELECT 1;\n");
    const fifth = await runApp({ PCRM_MIGRATIONS_DIR: migrations });
    const backups = readdirSync(path.join(dataDir, "backups"));
    check("pending migrations run after an automatic backup", fifth.code === 0 && backups.some((f) => f.endsWith("-pre-update.pcrmbak")), `${fifth.out.slice(-1500)} ${backups}`);

    // the backups now carry the update's migration, so the following runs are that version of the app
    // (an older app refuses them: "made by a newer version")
    const older = await runApp();
    check("an older app refuses data a newer version has updated", older.code !== 0 && /updated by a newer version/.test(older.out), older.out.slice(-800));

    // 6. the database folder is lost, keys.json and the backups remain: restore the newest backup, no key needed
    const markers5 = fifth.report?.auditMarkers;
    rmSync(path.join(dataDir, "data"), { recursive: true, force: true });
    const sixth = await runApp({ PCRM_MIGRATIONS_DIR: migrations, PCRM_SELFTEST_FIRST_START: "latest" });
    check("a lost database folder is restored from the newest backup", sixth.code === 0 && sixth.report?.events.includes("restored") && sixth.report.auditMarkers === markers5 + 1, `${markers5} -> ${sixth.report?.auditMarkers} ${sixth.out.slice(-1500)}`);

    // 7. a new computer: only the backups and the recovery key
    const recoveryKey = sixth.report?.recoveryKey;
    rmSync(path.join(dataDir, "data"), { recursive: true, force: true });
    rmSync(path.join(dataDir, "keys.json"), { force: true });
    const otherKey = execFileSync(process.execPath, [path.join(repo, "dist", "ops.js"), "new-key"], { encoding: "utf8" }).trim();
    const wrong = await runApp({ PCRM_MIGRATIONS_DIR: migrations, PCRM_SELFTEST_FIRST_START: "latest", PCRM_SELFTEST_RECOVERY_KEY: otherKey });
    check("a wrong recovery key is refused", wrong.code !== 0 && /does not belong to this backup/.test(wrong.out), wrong.out.slice(-800));
    const missing = await runApp({ PCRM_MIGRATIONS_DIR: migrations, PCRM_SELFTEST_FIRST_START: "latest" });
    check("without the recovery key the restore asks for it", missing.code !== 0 && /Enter its recovery key/.test(missing.out), missing.out.slice(-800));
    const seventh = await runApp({ PCRM_MIGRATIONS_DIR: migrations, PCRM_SELFTEST_FIRST_START: "latest", PCRM_SELFTEST_RECOVERY_KEY: recoveryKey?.toLowerCase().replace(/-/g, " ") });
    check("the recovery key restores everything on a new computer", seventh.code === 0 && seventh.report?.events.includes("restored") && seventh.report.auditMarkers === sixth.report.auditMarkers + 1, seventh.out.slice(-1500));
    check("the same recovery key stays valid afterwards", seventh.report?.recoveryKey === recoveryKey);
  }

  // 8. the Developer console's desktop controls, through the app window
  const eighth = await runApp({ ...withMigrations(), PCRM_SELFTEST_CONSOLE: "1" });
  const c = eighth.report?.console ?? {};
  check("console: the controls refuse staff pages and signed-out visitors", c.refusedOnStaffPage === true && c.refusedBeforeSignIn === true, JSON.stringify(c));
  check("console: the Developer signs in and enrols", c.login === 200 && c.enrol === 200, JSON.stringify(c));
  check("console: the desktop page is in the console menu", c.navShowsThisComputer === true);
  check("console: status and back up now work", c.status === true && c.backup === true && c.latestReason === "manual", JSON.stringify(c));
  check("console: restore needs a valid authenticator code and a listed backup", /not valid/.test(c.wrongCode ?? "") && /Choose a backup/.test(c.unknownBackup ?? ""), JSON.stringify(c));
  check("console: restore works and the window returns to the console", c.restore === "ok" && c.restoredEvent && c.afterRestoreUrl === "/platform/desktop" && c.preRestoreBackup, JSON.stringify(c));
  check("console: backup and restore are in the audit log after the restore", c.audit?.["desktop.backup"] === 1 && c.audit?.["desktop.restore"] === 1, JSON.stringify(c.audit));
  check("console: the app is healthy after the restore", eighth.code === 0 && eighth.report?.ok, eighth.out.slice(-1500));

  // 9. the Developer lost the password and the authenticator: a Windows administrator recovers the account
  let elevated = true;
  try {
    execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "net.exe"), ["session"], { stdio: "ignore" });
  } catch {
    elevated = false;
  }
  if (!elevated) {
    const refused = await runApp(withMigrations(), ["--recover-owner"]);
    check("recovery is refused without administrator rights", refused.code !== 0 && !refused.report);
  }
  const recovered = await runApp({ ...withMigrations(), PCRM_SELFTEST_ASSUME_ADMIN: "1" }, ["--recover-owner"]);
  const fresh = recovered.report?.recovered;
  check("recovery sets a new password for the Developer", recovered.code === 0 && fresh?.email === owner.PLATFORM_OWNER_EMAIL && fresh.password.length >= 12, recovered.out.slice(-1500));
  const tenth = await runApp({ ...withMigrations(), PCRM_SELFTEST_CONSOLE: "1", PLATFORM_OWNER_PASSWORD: fresh?.password ?? "x" });
  const c2 = tenth.report?.console ?? {};
  check("after recovery the new password signs in and two-factor is set up again", c2.login === 200 && c2.enrol === 200 && c2.restore === "ok", JSON.stringify(c2));
} finally {
  if (pgRunning()) execFileSync(path.join(pgBin, "pg_ctl.exe"), ["stop", "-D", path.join(dataDir, "data"), "-m", "fast"], { stdio: "ignore" });
  if (failures) console.log(`kept ${root} for inspection`);
  else rmSync(root, { recursive: true, force: true });
}
console.log(failures ? `${failures} check(s) failed` : "all desktop checks passed");
process.exit(failures ? 1 : 0);
