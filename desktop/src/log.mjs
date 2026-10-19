/**
 * Log files in <data>\logs: one JSON object per line, rotated by size (name.log, name.1.log, ...).
 * Child processes (web server, worker, PostgreSQL) write their own files through openLogStream.
 */
import { createWriteStream, existsSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

/** Moves name.log to name.1.log (and so on) when it has grown past the limit. */
export function rotate(file, maxBytes = MAX_BYTES, keep = KEEP) {
  if (!existsSync(file) || statSync(file).size < maxBytes) return;
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  rmSync(`${base}.${keep}${ext}`, { force: true });
  for (let i = keep - 1; i >= 1; i--) {
    if (existsSync(`${base}.${i}${ext}`)) renameSync(`${base}.${i}${ext}`, `${base}.${i + 1}${ext}`);
  }
  renameSync(file, `${base}.1${ext}`);
}

export function openLogStream(file) {
  rotate(file);
  return createWriteStream(file, { flags: "a" });
}

export function createLogger(file, { echo = false } = {}) {
  const stream = openLogStream(file);
  const write = (level, msg, extra = {}) => {
    const line = JSON.stringify({ at: new Date().toISOString(), level, svc: "desktop", msg, ...extra });
    stream.write(line + "\n");
    if (echo) console.log(line);
  };
  return {
    file,
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
    close: () => new Promise((resolve) => stream.end(resolve)),
  };
}
