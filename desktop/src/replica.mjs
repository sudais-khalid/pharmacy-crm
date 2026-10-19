/**
 * The local replica (architecture, section 2.4): encrypted snapshots in <data>\backups, taken every four
 * hours while the app runs, when it closes, before migrations and updates, and on demand. Each snapshot is
 * written under a temporary name, verified by decrypting it completely, then renamed, so the folder only
 * ever holds complete, readable backups. An optional mirror folder (another drive, a USB stick, a synced
 * cloud folder) receives a copy of each one.
 *
 * Retention: the newest 24 snapshots, plus the newest snapshot of each day for 30 days.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const EXT = ".pcrmbak";
const KEEP_LATEST = 24;
const KEEP_DAYS = 30;
const INTERVAL_MS = 4 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-");
/** "2026-10-19T11-49-39-736Z-scheduled.pcrmbak" -> Date */
function takenAt(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(name);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

/** Snapshots in a folder, newest first. */
export function listBackups(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(EXT) && takenAt(n))
    .map((name) => ({ name, file: path.join(dir, name), at: takenAt(name), reason: name.slice(25, -EXT.length), size: statSync(path.join(dir, name)).size }))
    .sort((a, b) => b.at - a.at);
}

/** Which snapshots the retention rule keeps (pure, for tests). */
export function retained(backups, now = new Date()) {
  const keep = new Set(backups.slice(0, KEEP_LATEST).map((b) => b.name));
  const days = new Set();
  for (const b of backups) {
    if (now - b.at > KEEP_DAYS * 24 * 60 * 60 * 1000) continue;
    const day = b.at.toISOString().slice(0, 10);
    if (days.has(day)) continue;
    days.add(day);
    keep.add(b.name);
  }
  return keep;
}

export function prune(dir, now = new Date()) {
  const all = listBackups(dir);
  const keep = retained(all, now);
  const removed = [];
  for (const b of all) {
    if (keep.has(b.name)) continue;
    rmSync(b.file, { force: true });
    removed.push(b.name);
  }
  // leftovers of a snapshot interrupted by a power cut
  for (const n of readdirSync(dir)) if (n.endsWith(".partial")) rmSync(path.join(dir, n), { force: true });
  return removed;
}

export class Replica {
  /**
   * @param {{ dir: string, config: import("./store.mjs").ConfigStore, log: any,
   *   create: (file: string) => Promise<unknown>, verify: (file: string) => Promise<unknown> }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.timer = null;
    this.running = null;
  }

  get mirrorDir() {
    return this.config.get("mirrorDir") || null;
  }

  latest() {
    return listBackups(this.dir)[0] ?? null;
  }

  /** Takes a snapshot now. Concurrent calls share one snapshot. */
  snapshot(reason) {
    if (!this.running) {
      this.running = this.#take(reason).finally(() => (this.running = null));
    }
    return this.running;
  }

  async #take(reason) {
    const started = Date.now();
    const name = `${stamp()}-${reason}${EXT}`;
    const final = path.join(this.dir, name);
    const partial = `${final}.partial`;
    try {
      await this.create(partial);
      await this.verify(partial);
      renameSync(partial, final);
    } catch (e) {
      rmSync(partial, { force: true });
      this.config.set({ lastBackupError: { at: new Date().toISOString(), reason, error: String(e?.message ?? e) } });
      this.log.error("backup failed", { reason, error: String(e?.stack ?? e) });
      throw e;
    }
    const size = statSync(final).size;
    const removed = prune(this.dir);
    const mirror = this.#mirror(final, name);
    this.config.set({ lastBackup: { at: new Date().toISOString(), reason, file: final, size, mirror }, lastBackupError: null });
    this.log.info("backup written", { reason, file: final, size, ms: Date.now() - started, removed, mirror });
    return { file: final, size, mirror };
  }

  /** Copies a snapshot to the mirror folder. A missing drive is reported, not fatal. */
  #mirror(file, name) {
    const dir = this.mirrorDir;
    if (!dir) return null;
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `${name}.partial`);
      copyFileSync(file, tmp);
      renameSync(tmp, path.join(dir, name));
      prune(dir);
      return { ok: true, dir };
    } catch (e) {
      this.log.warn("could not copy the backup to the mirror folder", { dir, error: String(e?.message ?? e) });
      return { ok: false, dir, error: String(e?.message ?? e) };
    }
  }

  /** Every ten minutes, takes a snapshot when the newest one is four hours old or more. */
  startSchedule() {
    const tick = () => {
      const last = this.latest();
      if (!last || Date.now() - last.at.getTime() >= INTERVAL_MS) this.snapshot("scheduled").catch(() => {});
    };
    this.timer = setInterval(tick, CHECK_EVERY_MS);
    this.timer.unref?.();
    tick();
  }

  stopSchedule() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
