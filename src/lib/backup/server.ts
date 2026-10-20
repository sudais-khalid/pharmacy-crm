import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createBackup, verifyBackup } from "./backup";
import { parseRecoveryKey } from "./keys";

/**
 * Nightly backups on a server (roadmap 9.1). The worker writes an encrypted snapshot to BACKUP_DIR under a
 * temporary name, decrypts it completely to verify it, then renames it, so the folder only holds complete,
 * readable backups. A copy goes to BACKUP_OFFSITE_DIR (a mounted network drive, a synced folder) when set.
 * The result of each run is kept in status.json for the health check and the Developer console.
 *
 * Retention: the newest backup of each of the last BACKUP_KEEP_DAILY days, and the newest of each of the
 * last BACKUP_KEEP_MONTHLY months. Restore runs from the server shell (deploy/restore.sh), with the app
 * stopped, into a fresh database that then replaces the old one.
 */
export const EXT = ".pcrmbak";
const STATUS = "status.json";

export type ServerBackupConfig = { dir: string; key: Buffer; keepDaily: number; keepMonthly: number; offsiteDir: string | null };
export type ServerBackup = { name: string; file: string; at: Date; reason: string; size: number };
export type BackupStatus = { at: string; ok: boolean; name?: string; size?: number; rows?: number; offsite?: boolean; removed?: number; error?: string; lastSuccessAt?: string | null };

/** The configuration from the environment, or null when server backups are not set up (the desktop has its own). */
export function serverBackupConfig(env: Record<string, string | undefined> = process.env): ServerBackupConfig | null {
  if (!env.BACKUP_DIR) return null;
  if (!env.BACKUP_KEY) throw new Error("BACKUP_DIR is set but BACKUP_KEY is empty: create one with `node dist/ops.js new-key` and keep a copy offline.");
  const n = (v: string | undefined, d: number) => (v && Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : d);
  return { dir: env.BACKUP_DIR, key: parseRecoveryKey(env.BACKUP_KEY), keepDaily: n(env.BACKUP_KEEP_DAILY, 14), keepMonthly: n(env.BACKUP_KEEP_MONTHLY, 12), offsiteDir: env.BACKUP_OFFSITE_DIR || null };
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");
/** "2026-10-19T11-49-39-736Z-nightly.pcrmbak" -> Date (the desktop app names its snapshots the same way) */
function takenAt(name: string) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(name);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

/** Complete backups in a folder, newest first. */
export function listServerBackups(dir: string): ServerBackup[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(EXT) && takenAt(n))
    .map((name) => ({ name, file: path.join(dir, name), at: takenAt(name)!, reason: name.slice(25, -EXT.length), size: statSync(path.join(dir, name)).size }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Which backups the retention rule keeps (pure, for tests). The newest one is always kept. */
export function retainedServer(backups: ServerBackup[], keepDaily: number, keepMonthly: number, now = new Date()) {
  const keep = new Set(backups.slice(0, 1).map((b) => b.name));
  const dayLimit = new Date(now.getTime() - keepDaily * 86_400_000).toISOString().slice(0, 10);
  const monthLimit = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - keepMonthly + 1, 1)).toISOString().slice(0, 7);
  const days = new Set<string>();
  const months = new Set<string>();
  for (const b of backups) {
    const day = b.at.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    if (day > dayLimit && !days.has(day)) { days.add(day); keep.add(b.name); }
    if (month >= monthLimit && !months.has(month)) { months.add(month); keep.add(b.name); }
  }
  return keep;
}

function prune(dir: string, cfg: ServerBackupConfig, now: Date) {
  const all = listServerBackups(dir);
  const keep = retainedServer(all, cfg.keepDaily, cfg.keepMonthly, now);
  let removed = 0;
  for (const b of all) if (!keep.has(b.name)) { rmSync(b.file, { force: true }); removed++; }
  // leftovers of a run interrupted by a restart
  for (const n of readdirSync(dir)) if (n.endsWith(".partial")) rmSync(path.join(dir, n), { force: true });
  return removed;
}

export function readBackupStatus(dir: string): BackupStatus | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, STATUS), "utf8")) as BackupStatus;
  } catch {
    return null;
  }
}

/** Takes, verifies, copies offsite and prunes one backup. Never throws: the outcome is in the result and status.json. */
export async function runServerBackup(cfg: ServerBackupConfig, connectionString: string, opts: { reason?: string; now?: Date; appVersion?: string } = {}): Promise<BackupStatus> {
  const now = opts.now ?? new Date();
  const name = `${stamp(now)}-${opts.reason ?? "nightly"}${EXT}`;
  const previous = readBackupStatus(cfg.dir);
  let status: BackupStatus;
  try {
    mkdirSync(cfg.dir, { recursive: true });
    const partial = path.join(cfg.dir, `${name}.partial`);
    rmSync(partial, { force: true });
    await createBackup(connectionString, partial, cfg.key, { appVersion: opts.appVersion });
    const manifest = await verifyBackup(partial, cfg.key);
    const file = path.join(cfg.dir, name);
    renameSync(partial, file);
    let offsite = false;
    if (cfg.offsiteDir) {
      mkdirSync(cfg.offsiteDir, { recursive: true });
      copyFileSync(file, path.join(cfg.offsiteDir, `${name}.partial`));
      renameSync(path.join(cfg.offsiteDir, `${name}.partial`), path.join(cfg.offsiteDir, name));
      prune(cfg.offsiteDir, cfg, now);
      offsite = true;
    }
    const removed = prune(cfg.dir, cfg, now);
    status = { at: now.toISOString(), ok: true, name, size: statSync(file).size, rows: manifest.tables.reduce((n, t) => n + t.rows, 0), offsite, removed, lastSuccessAt: now.toISOString() };
  } catch (e) {
    status = { at: now.toISOString(), ok: false, error: e instanceof Error ? e.message : String(e), lastSuccessAt: previous?.lastSuccessAt ?? null };
  }
  try {
    writeFileSync(path.join(cfg.dir, STATUS), JSON.stringify(status, null, 2));
  } catch {
    // the folder itself is unusable; the result still reaches the worker log
  }
  return status;
}
