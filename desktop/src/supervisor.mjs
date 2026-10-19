/**
 * Start-up and shut-down of one installation (architecture, sections 2.3 and 2.4):
 *   data folder -> secrets -> PostgreSQL -> backup if migrations are pending -> migrations
 *   -> pharmacy login role -> web server -> worker.
 * Stopping runs the same chain backwards. The Electron window and tray live in main.mjs.
 */
import { app } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DB_NAME, LocalDatabase, freePort, portIsFree } from "./database.mjs";
import { createLogger } from "./log.mjs";
import { layout, prepareDataRoot } from "./paths.mjs";
import { ChildService, readyWhenHealthy, readyWhenOutput } from "./services.mjs";
import { ConfigStore, SecretStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** Where the server bundle and PostgreSQL binaries are: inside the installed app, or in this repository. */
export function locateBundle() {
  const server = app.isPackaged ? path.join(process.resourcesPath, "server") : path.resolve(here, "..", "..", ".next", "standalone");
  const pgBin = app.isPackaged ? path.join(process.resourcesPath, "postgres", "bin") : path.resolve(here, "..", "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
  const bundle = {
    server,
    serverJs: path.join(server, "server.js"),
    workerJs: path.join(server, "dist", "worker.js"),
    opsLib: path.join(server, "dist", "ops-lib.js"),
    // tests may point at a copy with extra migrations; an installed app always uses its own
    migrations: !app.isPackaged && process.env.PCRM_MIGRATIONS_DIR ? path.resolve(process.env.PCRM_MIGRATIONS_DIR) : path.join(server, "prisma", "migrations"),
    pgBin,
  };
  const missing = Object.entries(bundle).filter(([, p]) => !existsSync(p));
  if (missing.length) throw new Error(`The app is incomplete (missing ${missing.map(([k, p]) => `${k}: ${p}`).join(", ")}). ${app.isPackaged ? "Reinstall it." : "Run npm run build:desktop first."}`);
  return bundle;
}

export class Supervisor {
  constructor({ status = () => {}, echoLogs = false } = {}) {
    this.status = status;
    this.echoLogs = echoLogs;
    this.paths = layout();
    this.state = "stopped";
    this.events = [];
  }

  note(event) {
    this.events.push(event);
  }

  async start() {
    this.state = "starting";
    const { paths } = this;
    this.status("Preparing the data folder");
    const prepared = await prepareDataRoot(paths);
    const log = (this.log = createLogger(path.join(paths.logs, "desktop.log"), { echo: this.echoLogs }));
    log.info("starting", { version: app.getVersion(), dataRoot: paths.root, createdDataRoot: prepared.created, packaged: app.isPackaged });
    if (prepared.aclError) log.warn("could not restrict the data folder's permissions", { error: prepared.aclError });

    if (!SecretStore.available()) throw new Error("Windows data protection is not available for this account, so secrets cannot be stored safely.");
    const config = (this.config = new ConfigStore(paths.config));
    const secrets = (this.secrets = new SecretStore(paths.keys));
    const bundle = (this.bundle = locateBundle());
    const ops = (this.ops = createRequire(import.meta.url)(bundle.opsLib));

    // PostgreSQL on its fixed per-installation port
    const db = (this.db = new LocalDatabase({ binDir: bundle.pgBin, pgdata: paths.pgdata, tmp: paths.tmp, logFile: path.join(paths.logs, "postgres.log"), port: config.get("pgPort") ?? 0, log }));
    if (db.initialised && (await db.isRunning())) {
      log.warn("stopping a PostgreSQL server left running by an earlier session");
      await db.stop();
    }
    db.port = await this.choosePort("pgPort", db.port);

    let password;
    if (!db.initialised) {
      this.status("Creating the database (first start)");
      password = random(24);
      secrets.set("dbPassword", password);
      await db.initialise(password);
      config.set({ installedAt: new Date().toISOString() });
      this.note("database-created");
      log.info("database cluster created");
    } else {
      password = secrets.get("dbPassword");
      if (password === null) {
        this.status("Restoring access to the local database");
        log.warn("database password missing or unreadable for this Windows account; setting a new one locally", { unreadable: secrets.unreadable.has("dbPassword") });
        password = random(24);
        await db.resetPassword(password);
        secrets.set("dbPassword", password);
        this.note("database-password-reset");
      }
    }
    this.status("Starting the database");
    await db.start();
    await db.ensureDatabase(password);
    const superUrl = db.url(password);
    this.superUrl = superUrl;

    // The backup key protects the local replica. A lost key gets a new one; the new recovery key is shown
    // to the Developer (old backups still need the old recovery key).
    const backupKey = secrets.getOrCreate("backupKey", () => ops.newBackupKey().toString("base64"));
    if (backupKey.created) {
      config.set({ recoveryKeyShown: false });
      this.note("backup-key-created");
      log.info(secrets.unreadable.has("backupKey") ? "backup key was unreadable; created a new one" : "backup key created");
    }
    this.backupKey = Buffer.from(backupKey.value, "base64");

    // Migrations, after a safety backup when this database already holds data
    const all = ops.readMigrations(bundle.migrations);
    const pending = await ops.pendingMigrations(superUrl, bundle.migrations);
    if (pending.length) {
      if (pending.length < all.length) {
        this.status("Backing up before updating the database");
        const file = await this.backup("pre-update");
        log.info("backup before migrations", { file, pending });
      }
      this.status("Updating the database");
      const result = await ops.applyMigrations(superUrl, bundle.migrations, { log: (m) => log.info(m) });
      log.info("migrations applied", { applied: result.applied });
    }

    const appPassword = random(24);
    await db.prepareAppLogin(password, appPassword);

    // Long-lived application secrets
    const jwtSecret = secrets.getOrCreate("jwtSecret", () => random(48)).value;
    const totpKey = secrets.getOrCreate("totpKey", () => random(48));
    if (totpKey.created && config.get("installedAt") && !this.events.includes("database-created")) {
      log.warn("two-factor encryption key was missing; existing two-factor enrolments must be redone with --recover-owner");
    }

    // Web server and worker
    const webPort = await this.choosePort("webPort", config.get("webPort") ?? 0);
    this.baseUrl = `http://127.0.0.1:${webPort}`;
    const env = {
      DEPLOY_MODE: "desktop",
      APP_VERSION: app.getVersion(),
      DATABASE_URL: superUrl,
      APP_DATABASE_URL: db.url(appPassword, { user: "pcrm_web" }),
      JWT_SECRET: jwtSecret,
      TOTP_ENCRYPTION_KEY: totpKey.value,
      APP_TIMEZONE: config.get("timezone") ?? "Asia/Karachi",
      DATA_DIR: paths.root,
    };
    this.web = new ChildService({
      name: "web server",
      script: bundle.serverJs,
      cwd: bundle.server,
      env: { ...env, PORT: String(webPort), HOSTNAME: "127.0.0.1", LOG_SERVICE: "web" },
      logFile: path.join(paths.logs, "web.log"),
      ready: readyWhenHealthy(`${this.baseUrl}/api/health`),
      onExit: (code) => this.onChildExit(this.web, code),
    });
    this.worker = new ChildService({
      name: "worker",
      script: bundle.workerJs,
      cwd: bundle.server,
      env: { ...env, DATABASE_URL: superUrl, LOG_SERVICE: "worker" },
      logFile: path.join(paths.logs, "worker.log"),
      ipc: true,
      ready: readyWhenOutput("worker started"),
      onExit: (code) => this.onChildExit(this.worker, code),
    });
    this.status("Starting the app");
    await this.web.start();
    await this.worker.start();
    this.restarts = [];
    this.state = "running";
    log.info("running", { url: this.baseUrl, database: `127.0.0.1:${db.port}/${DB_NAME}` });
    return this.baseUrl;
  }

  /** The stored port when it is still free, otherwise a new one (saved for next time). */
  async choosePort(name, stored) {
    if (stored && (await portIsFree(stored))) return stored;
    const port = await freePort();
    if (stored) this.log.warn(`port ${stored} for ${name} is in use by another program; using ${port}`);
    this.config.set({ [name]: port });
    return port;
  }

  /** Restarts a child that stopped on its own, at most three times in ten minutes. */
  async onChildExit(svc, code) {
    if (this.state !== "running") return;
    this.log.error(`${svc.name} stopped unexpectedly`, { code, output: svc.output.slice(-2000) });
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 10 * 60_000);
    if (this.restarts.length >= 3) {
      this.state = "failed";
      this.onFailure?.(new Error(`${svc.name} keeps stopping. See the logs in ${this.paths.logs}.`));
      return;
    }
    this.restarts.push(now);
    try {
      await svc.start();
      this.log.info(`${svc.name} restarted`);
    } catch (e) {
      this.log.error(`${svc.name} could not be restarted`, { error: String(e) });
    }
  }

  /** Writes an encrypted snapshot to the backups folder and returns its path. */
  async backup(reason) {
    const file = path.join(this.paths.backups, `${stamp()}-${reason}.pcrmbak`);
    await this.ops.createBackup(this.superUrl, file, this.backupKey, { appVersion: app.getVersion() });
    return file;
  }

  async stop() {
    if (this.state === "stopping" || this.state === "stopped") return;
    const previous = this.state;
    this.state = "stopping";
    const log = this.log;
    log?.info("stopping", { from: previous });
    await this.worker?.stop().catch((e) => log?.error("worker stop failed", { error: String(e) }));
    await this.web?.stop().catch((e) => log?.error("web server stop failed", { error: String(e) }));
    await this.db?.stop().catch((e) => log?.error("PostgreSQL stop failed", { error: String(e) }));
    log?.info("stopped");
    this.state = "stopped";
    await log?.close();
  }
}
