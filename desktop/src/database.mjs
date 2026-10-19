/**
 * The embedded PostgreSQL 16 cluster, driven with its own initdb and pg_ctl:
 *   - listens on 127.0.0.1 only, on the port stored for this installation;
 *   - scram-sha-256 password authentication for every connection;
 *   - pg_ctl starts it with a restricted token (works for administrator accounts) and stops it with a
 *     clean "fast" shutdown instead of killing the process.
 */
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { rotate } from "./log.mjs";

const run = promisify(execFile);
const RESET_HBA = "pcrm_reset_hba.conf";

export const DB_NAME = "pharmacy_crm";
export const SUPERUSER = "postgres";

/** True when nothing listens on 127.0.0.1:port. */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export class LocalDatabase {
  /** @param {{ binDir: string, pgdata: string, tmp: string, logFile: string, port: number, log: ReturnType<import("./log.mjs").createLogger> }} opts */
  constructor(opts) {
    Object.assign(this, opts);
    this.exe = (name) => path.join(this.binDir, `${name}.exe`);
  }

  get initialised() {
    return existsSync(path.join(this.pgdata, "PG_VERSION"));
  }

  async pgCtl(args, opts = {}) {
    return run(this.exe("pg_ctl"), args, { windowsHide: true, cwd: this.pgdata, ...opts });
  }

  /** Creates the cluster with the superuser password. The password file lives for the length of this call. */
  async initialise(password) {
    const pwfile = path.join(this.tmp, `pw-${process.pid}-${Date.now()}`);
    writeFileSync(pwfile, password + "\n", { mode: 0o600 });
    try {
      await run(this.exe("initdb"), ["-D", this.pgdata, "-U", SUPERUSER, "--auth=scram-sha-256", `--pwfile=${pwfile}`, "--encoding=UTF8", "--locale=C"], { windowsHide: true });
    } finally {
      rmSync(pwfile, { force: true });
    }
  }

  async isRunning() {
    try {
      await this.pgCtl(["status", "-D", this.pgdata]);
      return true;
    } catch {
      return false; // pg_ctl exits 3 when no server runs on this data directory
    }
  }

  /**
   * Starts the server. A server left running by a previous session (the app was killed) is stopped first,
   * so it always runs with the settings given here.
   */
  async start(extra = []) {
    if (await this.isRunning()) {
      this.log.warn("PostgreSQL was still running from an earlier session; restarting it");
      await this.stop();
    }
    rotate(this.logFile);
    const options = ["-p", String(this.port), "-c", "listen_addresses=127.0.0.1", "-c", "timezone=UTC", ...extra].join(" ");
    // The server inherits pg_ctl's standard handles; with pipes, pg_ctl would look unfinished for as long
    // as PostgreSQL runs. A file does not have that problem.
    const ctlLog = this.logFile.replace(/\.log$/, "-ctl.log");
    rotate(ctlLog);
    const before = existsSync(this.logFile) ? statSync(this.logFile).size : 0;
    const fd = openSync(ctlLog, "a");
    try {
      const code = await new Promise((resolve, reject) => {
        const p = spawn(this.exe("pg_ctl"), ["start", "-w", "-t", "120", "-D", this.pgdata, "-l", this.logFile, "-o", options], { cwd: this.pgdata, stdio: ["ignore", fd, fd], windowsHide: true });
        p.on("error", reject);
        p.on("exit", resolve);
      });
      if (code !== 0) {
        const server = existsSync(this.logFile) ? readFileSync(this.logFile).subarray(before).toString("utf8") : "";
        const tail = (server + readFileSync(ctlLog, "utf8").slice(-500)).trim().slice(-1500);
        throw new Error(`PostgreSQL did not start (pg_ctl exit ${code}): ${tail}`);
      }
    } finally {
      closeSync(fd);
    }
  }

  async stop() {
    if (!(await this.isRunning())) return;
    try {
      await this.pgCtl(["stop", "-w", "-t", "60", "-D", this.pgdata, "-m", "fast"]);
    } catch (e) {
      this.log.error("PostgreSQL did not stop in time; forcing it", { error: String(e?.stderr || e) });
      await this.pgCtl(["stop", "-w", "-t", "30", "-D", this.pgdata, "-m", "immediate"]).catch(() => {});
    }
  }

  url(password, { user = SUPERUSER, database = DB_NAME } = {}) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${this.port}/${database}?schema=public`;
  }

  async withClient(password, database, fn) {
    const client = new pg.Client({ host: "127.0.0.1", port: this.port, user: SUPERUSER, password, database });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  async ensureDatabase(password) {
    await this.withClient(password, "postgres", async (c) => {
      const found = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
      if (!found.rowCount) await c.query(`CREATE DATABASE ${DB_NAME} ENCODING 'UTF8' TEMPLATE template0`);
    });
  }

  /**
   * Sets a new superuser password when the stored one is lost (keys.json missing or unreadable for this
   * Windows account). The server is started once with a temporary rules file that trusts only the
   * superuser over loopback; pg_hba.conf itself is never changed, so a crash midway leaves normal
   * authentication in place.
   */
  async resetPassword(newPassword) {
    const hba = path.join(this.pgdata, RESET_HBA);
    writeFileSync(hba, `host all ${SUPERUSER} 127.0.0.1/32 trust\n`);
    try {
      await this.start(["-c", `hba_file=${RESET_HBA}`]);
      const client = new pg.Client({ host: "127.0.0.1", port: this.port, user: SUPERUSER, database: "postgres" });
      await client.connect();
      try {
        await client.query(`ALTER ROLE ${SUPERUSER} PASSWORD ${client.escapeLiteral(newPassword)}`);
      } finally {
        await client.end().catch(() => {});
      }
    } finally {
      await this.stop();
      rmSync(hba, { force: true });
    }
  }

  /**
   * The login the web server uses for pharmacy data: a member of pcrm_app (created by the row-level
   * security migration), so every query is limited to the current pharmacy. Its password is new on each
   * start and only ever held in memory.
   */
  async prepareAppLogin(password, appPassword) {
    await this.withClient(password, DB_NAME, async (c) => {
      await c.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcrm_web') THEN CREATE ROLE pcrm_web LOGIN IN ROLE pcrm_app; END IF;
      END $$`);
      await c.query(`ALTER ROLE pcrm_web PASSWORD ${c.escapeLiteral(appPassword)}`);
    });
  }
}
