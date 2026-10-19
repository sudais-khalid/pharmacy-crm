import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { Replica, listBackups, prune, retained } from "../src/replica.mjs";

const root = mkdtempSync(path.join(tmpdir(), "pcrm-replica-"));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const nameAt = (d, reason = "scheduled") => `${d.toISOString().replace(/[:.]/g, "-")}-${reason}.pcrmbak`;
const fakeConfig = () => {
  const data = {};
  return { data, get: (k) => data[k], set: (v) => Object.assign(data, v) };
};
const quietLog = { info() {}, warn() {}, error() {} };

describe("retention", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000);

  it("keeps the newest 24 and one per day for 30 days", () => {
    // six snapshots a day (every four hours) for 40 days
    const backups = [];
    for (let h = 0; h < 40 * 24; h += 4) backups.push({ name: nameAt(hoursAgo(h)), at: hoursAgo(h) });
    const keep = retained(backups, now);
    const newest = backups.slice(0, 24).map((b) => b.name);
    assert.ok(newest.every((b) => keep.has(b)));
    const days = new Set(backups.filter((b) => now - b.at <= 30 * 86400_000).map((b) => b.at.toISOString().slice(0, 10)));
    assert.equal(keep.size, 24 + [...days].filter((d) => !backups.slice(0, 24).some((b) => b.at.toISOString().startsWith(d))).length);
    assert.ok(![...keep].some((name) => backups.find((b) => b.name === name).at < hoursAgo(31 * 24)));
  });
});

describe("snapshots", () => {
  it("are written under a temporary name, verified, then kept", async () => {
    const dir = mkdtempSync(path.join(root, "s-"));
    const seen = [];
    const config = fakeConfig();
    const replica = new Replica({
      dir,
      config,
      log: quietLog,
      create: async (file) => {
        seen.push(path.basename(file));
        writeFileSync(file, "x".repeat(100));
      },
      verify: async (file) => assert.ok(existsSync(file)),
    });
    const r = await replica.snapshot("manual");
    assert.match(seen[0], /-manual\.pcrmbak\.partial$/);
    assert.equal(readdirSync(dir).length, 1);
    assert.ok(r.file.endsWith("-manual.pcrmbak") && existsSync(r.file));
    assert.equal(config.data.lastBackup.reason, "manual");
    assert.equal(replica.latest().reason, "manual");
  });

  it("a snapshot that fails verification leaves nothing behind and is recorded", async () => {
    const dir = mkdtempSync(path.join(root, "f-"));
    const config = fakeConfig();
    const replica = new Replica({
      dir,
      config,
      log: quietLog,
      create: async (file) => writeFileSync(file, "broken"),
      verify: async () => {
        throw new Error("The backup file is damaged.");
      },
    });
    await assert.rejects(replica.snapshot("scheduled"), /damaged/);
    assert.deepEqual(readdirSync(dir), []);
    assert.match(config.data.lastBackupError.error, /damaged/);
  });

  it("calls made while a snapshot runs share it", async () => {
    const dir = mkdtempSync(path.join(root, "c-"));
    let creates = 0;
    const replica = new Replica({
      dir,
      config: fakeConfig(),
      log: quietLog,
      create: async (file) => {
        creates++;
        await new Promise((r) => setTimeout(r, 50));
        writeFileSync(file, "x");
      },
      verify: async () => {},
    });
    const [a, b] = await Promise.all([replica.snapshot("manual"), replica.snapshot("scheduled")]);
    assert.equal(creates, 1);
    assert.equal(a.file, b.file);
  });

  it("are copied to the mirror folder, and a missing mirror does not fail the backup", async () => {
    const dir = mkdtempSync(path.join(root, "m-"));
    const mirror = path.join(root, `mirror-${n++}`);
    const config = fakeConfig();
    const replica = new Replica({ dir, config, log: quietLog, create: async (f) => writeFileSync(f, "x"), verify: async () => {} });
    config.set({ mirrorDir: mirror });
    const ok = await replica.snapshot("manual");
    assert.deepEqual(ok.mirror, { ok: true, dir: mirror });
    assert.equal(listBackups(mirror).length, 1);

    // a file where the folder should be stands in for an unplugged drive
    const blocked = path.join(root, `blocked-${n++}`);
    writeFileSync(blocked, "not a folder");
    config.set({ mirrorDir: path.join(blocked, "sub") });
    const r = await replica.snapshot("manual");
    assert.equal(r.mirror.ok, false);
    assert.ok(existsSync(r.file));
  });
});

describe("prune", () => {
  it("removes snapshots outside the rule and interrupted ones, and leaves other files alone", () => {
    const dir = mkdtempSync(path.join(root, "p-"));
    const now = new Date();
    const names = [];
    for (let i = 0; i < 30; i++) {
      const name = nameAt(new Date(now.getTime() - i * 60_000)); // 30 snapshots today, a minute apart
      names.push(name);
      writeFileSync(path.join(dir, name), "x");
    }
    writeFileSync(path.join(dir, `${names[0]}.partial`), "half");
    writeFileSync(path.join(dir, "notes.txt"), "keep me");
    const removed = prune(dir, now);
    assert.equal(removed.length, 6);
    const left = readdirSync(dir);
    assert.equal(left.filter((f) => f.endsWith(".pcrmbak")).length, 24);
    assert.ok(left.includes("notes.txt"));
    assert.ok(!left.some((f) => f.endsWith(".partial")));
  });
});
