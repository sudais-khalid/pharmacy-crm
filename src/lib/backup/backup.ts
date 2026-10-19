import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { Writable, type Readable } from "node:stream";
import { createInterface } from "node:readline";
import { Client } from "pg";
import { to as copyTo, from as copyFrom } from "pg-copy-streams";
import { applyMigrations, readMigrations } from "@/lib/migrations/runner";
import { keyId } from "./keys";

/**
 * Encrypted, data-only backups (docs/plan/02-architecture.md, section 2.4; ADR-14).
 *
 * File layout:  "PCRMBAK1" | uint32 header length | header JSON | AES-256-GCM ciphertext | 16-byte tag
 * The header (format, creation time, key fingerprint, IV) is authenticated as additional data.
 * Plaintext, gzip compressed: one manifest JSON line, then per table "@@TABLE <name>", its rows in COPY
 * text format, and a "\." line. COPY text never produces a "\." line, so sections cannot be confused.
 * The schema is not stored: restore rebuilds it with the migrations, which keeps backups version aware.
 */
const MAGIC = Buffer.from("PCRMBAK1");
const FORMAT = 1;
/** Transient tables that are not worth keeping. _prisma_migrations is rebuilt by the migration runner. */
const SKIP_TABLES = new Set(["_prisma_migrations", "RateLimitHit", "IdempotencyKey"]);

export type BackupHeader = { format: number; createdAt: string; keyId: string; iv: string };
export type BackupManifest = {
  format: number;
  createdAt: string;
  appVersion: string;
  migrations: string[];
  tables: { name: string; columns: string[]; rows: number }[];
  /** Positions of every sequence (for example a global invoice counter in older versions). */
  sequences: { name: string; lastValue: string | null }[];
};

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function writeChunk(stream: Writable, chunk: Buffer | string) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

/** Writes a consistent, encrypted snapshot of every application table to `outFile`. */
export async function createBackup(connectionString: string, outFile: string, key: Buffer, opts: { appVersion?: string } = {}) {
  const iv = randomBytes(12);
  const header: BackupHeader = { format: FORMAT, createdAt: new Date().toISOString(), keyId: keyId(key), iv: iv.toString("base64") };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32BE(headerBytes.length);

  if (existsSync(outFile)) throw new Error(`A backup named ${outFile} already exists.`);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(headerBytes);
  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(outFile, { flags: "wx" }); // never overwrite an existing backup
  await once(out, "open");
  out.write(Buffer.concat([MAGIC, lengthBytes, headerBytes]));
  const done = pipeline(gzip, cipher, out, { end: false }).then(async () => {
    await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
  });

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // one snapshot for every table, so the backup is consistent even while the app keeps working
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = (
      await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      )
    ).rows.map((r) => r.table_name).filter((t) => !SKIP_TABLES.has(t));
    const migrations = (await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    )).rows.map((r) => r.migration_name);

    const sequences = (await client.query<{ name: string; last_value: string | null }>(
      `SELECT sequencename AS name, last_value::text FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
    )).rows.map((r) => ({ name: r.name, lastValue: r.last_value }));
    const manifest: BackupManifest = { format: FORMAT, createdAt: header.createdAt, appVersion: opts.appVersion ?? "dev", migrations, tables: [], sequences };
    for (const t of tables) {
      const columns = (await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t],
      )).rows.map((r) => r.column_name);
      const rows = Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${q(t)}`)).rows[0].n);
      manifest.tables.push({ name: t, columns, rows });
    }
    await writeChunk(gzip, JSON.stringify(manifest) + "\n");
    for (const t of manifest.tables) {
      await writeChunk(gzip, `@@TABLE ${t.name}\n`);
      const copy = client.query(copyTo(`COPY ${q(t.name)} (${t.columns.map(q).join(", ")}) TO STDOUT`)) as Readable;
      for await (const chunk of copy) await writeChunk(gzip, chunk as Buffer);
      await writeChunk(gzip, "\\.\n");
    }
    await client.query("COMMIT");
    gzip.end();
    await done;
    return { file: outFile, bytes: statSync(outFile).size, manifest };
  } catch (e) {
    gzip.destroy(e as Error);
    await done.catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Reads the plaintext header of a backup file. */
export function readBackupHeader(file: string): { header: BackupHeader; headerBytes: Buffer; bodyStart: number; size: number } {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    const start = Buffer.alloc(12);
    readSync(fd, start, 0, 12, 0);
    if (!start.subarray(0, 8).equals(MAGIC)) throw new Error("This is not a Pharmacy CRM backup file.");
    const len = start.readUInt32BE(8);
    if (len <= 0 || len > 64 * 1024 || 12 + len + 16 > size) throw new Error("The backup file is damaged.");
    const headerBytes = Buffer.alloc(len);
    readSync(fd, headerBytes, 0, len, 12);
    const header = JSON.parse(headerBytes.toString("utf8")) as BackupHeader;
    if (header.format !== FORMAT) throw new Error(`Backup format ${header.format} is not supported by this version.`);
    return { header, headerBytes, bodyStart: 12 + len, size };
  } finally {
    closeSync(fd);
  }
}

/** Decrypted, decompressed plaintext stream. Authentication is checked when the stream ends. */
function openPlaintext(file: string, key: Buffer) {
  const { header, headerBytes, bodyStart, size } = readBackupHeader(file);
  if (header.keyId !== keyId(key)) throw new Error("This backup was made with a different key. Enter the recovery key of the installation that made it.");
  const tag = Buffer.alloc(16);
  const fd = openSync(file, "r");
  readSync(fd, tag, 0, 16, size - 16);
  closeSync(fd);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAAD(headerBytes);
  decipher.setAuthTag(tag);
  const gunzip = createGunzip();
  const source = createReadStream(file, { start: bodyStart, end: size - 17 });
  const finished = pipeline(source, decipher, gunzip).catch((e: Error) => {
    throw new Error(/auth/i.test(e.message) ? "The backup file has been changed or damaged and cannot be trusted." : `The backup file is damaged (${e.message}).`);
  });
  finished.catch(() => {}); // callers await it; this only keeps an early exit from leaving it unhandled
  return { header, plaintext: gunzip, finished };
}

/** Section reader: manifest first, then each table's COPY lines. */
async function* readSections(plaintext: Readable) {
  const lines = createInterface({ input: plaintext, crlfDelay: Infinity });
  let manifest: BackupManifest | null = null;
  let table: string | null = null;
  let batch: string[] = [];
  for await (const line of lines) {
    if (!manifest) {
      manifest = JSON.parse(line) as BackupManifest;
      yield { kind: "manifest" as const, manifest };
      continue;
    }
    if (table === null) {
      if (!line.startsWith("@@TABLE ")) throw new Error("The backup file is damaged (unexpected section).");
      table = line.slice(8);
      yield { kind: "start" as const, table };
      continue;
    }
    if (line === "\\.") {
      if (batch.length) yield { kind: "rows" as const, table, data: batch.join("\n") + "\n" };
      batch = [];
      yield { kind: "end" as const, table };
      table = null;
      continue;
    }
    batch.push(line);
    if (batch.length >= 2000) {
      yield { kind: "rows" as const, table, data: batch.join("\n") + "\n" };
      batch = [];
    }
  }
  if (!manifest || table !== null) throw new Error("The backup file is incomplete.");
}

/** Decrypts the whole file and checks it against its manifest, without touching any database. */
export async function verifyBackup(file: string, key: Buffer) {
  const { plaintext, finished } = openPlaintext(file, key);
  let manifest: BackupManifest | null = null;
  const counts = new Map<string, number>();
  try {
    for await (const s of readSections(plaintext)) {
      if (s.kind === "manifest") manifest = s.manifest;
      if (s.kind === "rows") counts.set(s.table, (counts.get(s.table) ?? 0) + s.data.split("\n").length - 1);
    }
  } catch (e) {
    // damage usually shows up first as a parse or gzip error; the authentication result is the clearer reason
    plaintext.destroy();
    await finished;
    throw e;
  }
  await finished;
  for (const t of manifest!.tables) {
    if ((counts.get(t.name) ?? 0) !== t.rows) throw new Error(`The backup file is damaged: ${t.name} has ${counts.get(t.name) ?? 0} rows, expected ${t.rows}.`);
  }
  return manifest!;
}

export type RestoreResult = { manifest: BackupManifest; migratedAfter: string[] };

/**
 * Restores into an empty database. The whole file is verified first, so a wrong key or a damaged file
 * never touches the database. Then: migrations up to the backup's version, all rows in one transaction
 * (committed only after the file authenticates again), then the newer migrations.
 * Needs a superuser connection (it defers triggers and foreign-key checks while loading).
 */
export async function restoreBackup(connectionString: string, file: string, key: Buffer, migrationsDir: string, opts: { log?: (msg: string) => void } = {}): Promise<RestoreResult> {
  const log = opts.log ?? (() => {});
  log("verifying the backup file");
  const checked = await verifyBackup(file, key);
  const known = new Set(readMigrations(migrationsDir).map((m) => m.name));
  const unknown = checked.migrations.filter((m) => !known.has(m));
  if (unknown.length) throw new Error(`This backup was made by a newer version of the app (${unknown[unknown.length - 1]}). Update the app first.`);

  const { plaintext, finished } = openPlaintext(file, key);
  const sections = readSections(plaintext);
  const first = await sections.next();
  if (first.done || first.value.kind !== "manifest") {
    plaintext.destroy();
    throw new Error("The backup file is damaged (no manifest).");
  }
  const manifest = first.value.manifest;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existing = Number((await client.query(`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n);
    if (existing > 0) {
      plaintext.destroy();
      throw new Error("Restore needs an empty database.");
    }
    const last = manifest.migrations[manifest.migrations.length - 1];
    if (last) {
      log(`rebuilding the schema up to ${last}`);
      await applyMigrations(connectionString, migrationsDir, { upTo: last });
    }

    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    // migrations may seed rows (the role templates, for example); the backup's rows are the truth
    for (const t of manifest.tables) await client.query(`DELETE FROM ${q(t.name)}`);
    const columnsOf = new Map(manifest.tables.map((t) => [t.name, t.columns]));
    let copy: Writable | null = null;
    let copyDone: Promise<unknown> | null = null;
    for await (const s of sections) {
      if (s.kind === "start") {
        log(`loading ${s.table}`);
        const cols = columnsOf.get(s.table);
        if (!cols) throw new Error(`The backup file is damaged (unknown table ${s.table}).`);
        copy = client.query(copyFrom(`COPY ${q(s.table)} (${cols.map(q).join(", ")}) FROM STDIN`)) as Writable;
        copyDone = once(copy, "finish");
      } else if (s.kind === "rows" && copy) {
        await writeChunk(copy, s.data);
      } else if (s.kind === "end" && copy) {
        copy.end();
        await copyDone;
        copy = null;
      }
    }
    await finished; // throws if the file was changed: nothing has been committed yet

    for (const t of manifest.tables) {
      const n = Number((await client.query(`SELECT count(*) AS n FROM ${q(t.name)}`)).rows[0].n);
      if (n !== t.rows) throw new Error(`Restore check failed for ${t.name}: ${n} rows, expected ${t.rows}.`);
    }
    // sequences continue where they were, and never below the restored rows
    for (const sq of manifest.sequences ?? []) {
      const exists = (await client.query(`SELECT to_regclass($1) AS r`, [`public.${q(sq.name)}`])).rows[0].r;
      if (exists && sq.lastValue !== null) await client.query(`SELECT setval($1, $2::bigint, true)`, [`public.${q(sq.name)}`, sq.lastValue]);
    }
    const serials = await client.query<{ table_name: string; column_name: string; seq: string }>(
      `SELECT c.table_name, c.column_name, pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) AS seq
       FROM information_schema.columns c WHERE c.table_schema = 'public' AND pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) IS NOT NULL`,
    );
    for (const r of serials.rows) {
      // r.seq comes from pg_get_serial_sequence, already a quoted, schema-qualified name
      const cur = (await client.query<{ last_value: string; is_called: boolean }>(`SELECT last_value::text, is_called FROM ${r.seq}`)).rows[0];
      const used = cur.is_called ? BigInt(cur.last_value) : BigInt(cur.last_value) - 1n;
      const max = BigInt((await client.query<{ m: string }>(`SELECT COALESCE(max(${q(r.column_name)}), 0)::text AS m FROM ${q(r.table_name)}`)).rows[0].m);
      const next = (used > max ? used : max) + 1n;
      await client.query(`SELECT setval($1::regclass, $2::bigint, false)`, [r.seq, next.toString()]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    plaintext.destroy();
    await finished.catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }

  log("applying newer migrations");
  const after = await applyMigrations(connectionString, migrationsDir);
  return { manifest, migratedAfter: after.applied };
}
