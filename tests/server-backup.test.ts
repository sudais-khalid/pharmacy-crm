import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatRecoveryKey, listServerBackups, newBackupKey, readBackupStatus, retainedServer, runServerBackup, serverBackupConfig, verifyBackup, type ServerBackup } from "@/lib/backup";
import { resetDb, makeMedicine } from "./helpers";

const root = mkdtempSync(join(tmpdir(), "pcrm-server-backup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const at = (iso: string): ServerBackup => ({ name: `${iso.replace(/[:.]/g, "-")}-nightly.pcrmbak`, file: "", at: new Date(iso), reason: "nightly", size: 1 });

describe("server backup retention", () => {
  it("keeps the newest of each recent day and of each recent month", () => {
    const now = new Date("2026-10-20T03:00:00Z");
    const list = [
      at("2026-10-20T02:30:00.000Z"), at("2026-10-19T14:00:00.000Z"), at("2026-10-19T02:30:00.000Z"), at("2026-10-01T02:30:00.000Z"),
      at("2026-09-30T02:30:00.000Z"), at("2026-09-02T02:30:00.000Z"), at("2026-03-15T02:30:00.000Z"), at("2025-10-31T02:30:00.000Z"),
    ];
    const keep = retainedServer(list, 3, 3, now);
    expect([...keep].sort()).toEqual([
      "2026-09-30T02-30-00-000Z-nightly.pcrmbak", // newest of September
      "2026-10-19T14-00-00-000Z-nightly.pcrmbak", // newest of the 19th
      "2026-10-20T02-30-00-000Z-nightly.pcrmbak", // newest of the 20th and of October
    ]);
  });

  it("is off without BACKUP_DIR and refuses to run without a key", () => {
    expect(serverBackupConfig({})).toBeNull();
    expect(() => serverBackupConfig({ BACKUP_DIR: root })).toThrow(/BACKUP_KEY/);
    expect(serverBackupConfig({ BACKUP_DIR: root, BACKUP_KEY: formatRecoveryKey(newBackupKey()), BACKUP_KEEP_DAILY: "x" })).toMatchObject({ keepDaily: 14, keepMonthly: 12, offsiteDir: null });
  });
});

describe("server backup run", () => {
  it("writes a verified backup, copies it offsite, prunes old ones and records the outcome", async () => {
    await resetDb();
    await makeMedicine("Backup Check");
    const dir = join(root, "backups");
    const offsiteDir = join(root, "offsite");
    const key = newBackupKey();
    const cfg = { dir, key, keepDaily: 2, keepMonthly: 1, offsiteDir };
    // an old backup outside the rule and a run interrupted by a restart
    await runServerBackup(cfg, process.env.DATABASE_URL!, { now: new Date("2026-08-01T02:30:00Z") });
    writeFileSync(join(dir, "2026-10-19T02-30-00-000Z-nightly.pcrmbak.partial"), "half");

    const r = await runServerBackup(cfg, process.env.DATABASE_URL!, { now: new Date("2026-10-20T02:30:00Z"), appVersion: "test" });
    expect(r).toMatchObject({ ok: true, name: "2026-10-20T02-30-00-000Z-nightly.pcrmbak", offsite: true, removed: 1 });
    expect(r.rows).toBeGreaterThan(0);
    expect(listServerBackups(dir).map((b) => b.name)).toEqual(["2026-10-20T02-30-00-000Z-nightly.pcrmbak"]);
    expect(readdirSync(dir).some((n) => n.endsWith(".partial"))).toBe(false);
    expect(existsSync(join(offsiteDir, r.name!))).toBe(true);
    expect((await verifyBackup(join(offsiteDir, r.name!), key)).appVersion).toBe("test");
    expect(readBackupStatus(dir)).toMatchObject({ ok: true, lastSuccessAt: "2026-10-20T02:30:00.000Z" });
  });

  it("records a failure without losing the time of the last good backup", async () => {
    const dir = join(root, "backups");
    const r = await runServerBackup({ dir, key: newBackupKey(), keepDaily: 2, keepMonthly: 1, offsiteDir: null }, "postgresql://nobody:wrong@127.0.0.1:1/none", { now: new Date("2026-10-21T02:30:00Z") });
    expect(r.ok).toBe(false);
    expect(readBackupStatus(dir)).toMatchObject({ ok: false, lastSuccessAt: "2026-10-20T02:30:00.000Z" });
    expect(listServerBackups(dir)).toHaveLength(1);
  });
});
