/**
 * Where an installation keeps its data (architecture, section 2.4): %PROGRAMDATA%\PharmacyCRM, outside the
 * program folder so uninstalling the program leaves it in place. PCRM_DATA_DIR overrides it for tests.
 *
 *   data\        PostgreSQL cluster
 *   backups\     encrypted snapshots (the local replica)
 *   logs\        desktop, web, worker and PostgreSQL logs
 *   tmp\         short-lived files (never secrets for longer than one call)
 *   config.json  ports and settings
 *   keys.json    secrets, each protected with Windows DPAPI
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
// Absolute paths: other tools named whoami or icacls (Git for Windows ships a whoami) may come first on PATH.
const system32 = (exe) => path.join(process.env.SystemRoot || "C:\\Windows", "System32", exe);

export function dataRoot() {
  if (process.env.PCRM_DATA_DIR) return path.resolve(process.env.PCRM_DATA_DIR);
  return path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "PharmacyCRM");
}

export function layout(root = dataRoot()) {
  return {
    root,
    pgdata: path.join(root, "data"),
    backups: path.join(root, "backups"),
    logs: path.join(root, "logs"),
    tmp: path.join(root, "tmp"),
    config: path.join(root, "config.json"),
    keys: path.join(root, "keys.json"),
  };
}

/**
 * Creates the folder tree. A newly created root first has its permissions reduced to the current Windows
 * user, Administrators and SYSTEM, so the folders created inside it inherit that.
 * Returns whether the root was created now and any permission problem (reported, not fatal).
 */
export async function prepareDataRoot(paths) {
  const created = !existsSync(paths.root);
  mkdirSync(paths.root, { recursive: true });
  let aclError = null;
  if (created && process.platform === "win32") {
    try {
      await restrictToCurrentUser(paths.root);
    } catch (e) {
      aclError = String(e?.stderr || e?.message || e);
    }
  }
  for (const dir of [paths.backups, paths.logs, paths.tmp]) mkdirSync(dir, { recursive: true });
  return { created, aclError };
}

async function currentUserSid() {
  const { stdout } = await run(system32("whoami.exe"), ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
  const sid = stdout.trim().split(",").pop()?.replace(/"/g, "");
  if (!sid?.startsWith("S-1-")) throw new Error(`could not read the current user's SID from "${stdout.trim()}"`);
  return sid;
}

/** Replaces inherited permissions with: current user, Administrators (S-1-5-32-544) and SYSTEM (S-1-5-18). */
export async function restrictToCurrentUser(dir) {
  const sid = await currentUserSid();
  await run(system32("icacls.exe"), [dir, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"], { windowsHide: true });
}
