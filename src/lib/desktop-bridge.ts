"use client";

/**
 * window.pcrmDesktop: present only inside the Windows desktop app (desktop/src/preload-app.cjs). Every
 * call is checked by the app against the signed-in Developer, so these types are a convenience, not a
 * permission.
 */
export type DesktopBackup = { id: string; name: string; createdAt: string; size: number; reason: string; source: "backups" | "mirror" };
export type DesktopStatus = {
  version: { app: string; electron: string; node: string };
  dataRoot: string;
  backupsDir: string;
  mirrorDir: string | null;
  lastBackup: { at: string; reason: string; file: string; size: number; mirror: { ok: boolean; dir: string; error?: string } | null } | null;
  lastBackupError: { at: string; reason: string; error: string } | null;
  backups: DesktopBackup[];
  lan: DesktopLan;
};
/** Shop network access: off, the server listens on 127.0.0.1 only; on, also on the PC's network addresses. */
export type DesktopLan = { enabled: boolean; port: number; urls: string[]; firewall: "allowed" | "missing" | "unknown" };
type Result<T> = { ok: true; data: T } | { ok: false; error: string; needsKey?: boolean; fields?: Record<string, string> | null };

export type DesktopBridge = {
  version: number;
  status(): Promise<Result<DesktopStatus>>;
  backupNow(): Promise<Result<{ file: string; size: number; mirror: { ok: boolean; dir: string } | null }>>;
  chooseMirror(): Promise<Result<DesktopStatus | null>>;
  clearMirror(): Promise<Result<DesktopStatus>>;
  pickBackupFile(): Promise<Result<{ id: string; name: string; createdAt: string; size: number; needsKey: boolean } | null>>;
  restore(id: string, recoveryKey: string | null, code: string): Promise<Result<{ createdAt: string; migratedAfter: number }>>;
  openFolder(which: "backups" | "logs" | "data" | "mirror"): Promise<Result<null>>;
  setLan(enabled: boolean): Promise<Result<DesktopLan>>;
  onProgress(fn: (text: string) => void): () => void;
};

export function getDesktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { pcrmDesktop?: DesktopBridge }).pcrmDesktop ?? null;
}

export class DesktopError extends Error {
  constructor(message: string, public needsKey = false, public fields: Record<string, string> = {}) {
    super(message);
  }
}

/** Unwraps a bridge result, throwing its error. */
export async function desktopCall<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new DesktopError(r.error, Boolean(r.needsKey), r.fields ?? {});
  return r.data;
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
