/**
 * Start-up and shut-down of one installation (architecture, sections 2.3 and 2.4):
 *   data folder -> secrets -> PostgreSQL -> backup if migrations are pending -> migrations
 *   -> pharmacy login role -> web server -> worker.
 * Stopping runs the same chain backwards. The Electron window and tray live in main.mjs.
 */
import { app } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DB_NAME, LocalDatabase, freePort, portIsFree } from "./database.mjs";
import { createLogger } from "./log.mjs";
import { allowThroughFirewall, firewallState, lanAddresses } from "./network.mjs";
import { layout, prepareDataRoot } from "./paths.mjs";
import { Replica, listBackups } from "./replica.mjs";
import { ChildService, readyWhenHealthy, readyWhenOutput } from "./services.mjs";
import { ConfigStore, SecretStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const random = (bytes = 32) => randomBytes(bytes).toString("base64url");

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
  // the server would load an .env file found next to it; a build must never carry one (local secrets)
  if (readdirSync(server).some((f) => f.startsWith(".env"))) throw new Error(`The app folder ${server} contains an .env file. Rebuild with npm run build:desktop.`);
  const missing = Object.entries(bundle).filter(([, p]) => !existsSync(p));
  if (missing.length) throw new Error(`The app is incomplete (missing ${missing.map(([k, p]) => `${k}: ${p}`).join(", ")}). ${app.isPackaged ? "Reinstall it." : "Run npm run build:desktop first."}`);
  return bundle;
}

const RESTORE_DB = `${DB_NAME}_restore`;

export class Supervisor {
  /**
   * @param {{ status?: (text: string) => void, echoLogs?: boolean,
   *   firstStart?: (supervisor: Supervisor) => Promise<void> }} opts
   *   firstStart runs once on a new data folder, with the empty database started; it may call restore().
   */
  constructor({ status = () => {}, echoLogs = false, firstStart = null } = {}) {
    this.status = status;
    this.firstStart = firstStart;
    this.echoLogs = echoLogs;
    this.paths = layout();
    this.state = "stopped";
    this.events = [];
  }

  note(event) {
    this.events.push(event);
  }

  /**
   * The data folder, secrets and PostgreSQL with the pharmacy database, nothing else. start() continues
   * from here; --recover-owner only needs this much.
   */
  async openDatabase() {
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
      config.set({ installedAt: new Date().toISOString(), setupPending: true });
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
    this.password = password;
    this.superUrl = db.url(password);
  }

  /** Where the Developer account of a new installation comes from: the build's owner.json. */
  ownerEnv() {
    // tests and local runs may set the variables directly
    if (process.env.PLATFORM_OWNER_EMAIL) return {};
    const file = app.isPackaged ? path.join(process.resourcesPath, "owner.json") : path.resolve(here, "..", "build", "owner.json");
    if (!existsSync(file)) {
      this.log.warn("no owner.json in this build: a new installation has no Developer account to sign in with", { file });
      return {};
    }
    const owner = JSON.parse(readFileSync(file, "utf8"));
    return { PLATFORM_OWNER_EMAIL: owner.email, PLATFORM_OWNER_NAME: owner.name ?? "Developer", PLATFORM_OWNER_PASSWORD_HASH: owner.passwordHash };
  }

  async start() {
    await this.openDatabase();
    const { paths, config, secrets, bundle, ops, db, log, password, superUrl } = this;

    // until a choice succeeds (setup closed, a restore failed) the next start asks again; the database
    // is still empty then, because a restore only replaces it once complete
    if (config.get("setupPending") && this.firstStart) {
      this.status("Waiting for the setup choice");
      await this.firstStart(this);
      this.status("Starting");
    }
    if (config.get("setupPending")) config.set({ setupPending: false });

    // The backup key protects the local replica. A lost key gets a new one; the new recovery key is shown
    // to the Developer (old backups still need the old recovery key).
    const backupKey = secrets.getOrCreate("backupKey", () => ops.newBackupKey().toString("base64"));
    if (backupKey.created) {
      config.set({ recoveryKeyShown: false });
      this.note("backup-key-created");
      log.info(secrets.unreadable.has("backupKey") ? "backup key was unreadable; created a new one" : "backup key created");
    }
    this.backupKey = Buffer.from(backupKey.value, "base64");
    this.replica = new Replica({
      dir: paths.backups,
      config,
      log,
      create: (file) => ops.createBackup(superUrl, file, this.backupKey, { appVersion: app.getVersion() }),
      verify: (file) => ops.verifyBackup(file, this.backupKey),
    });

    // Migrations, after a safety backup when this database already holds data
    const all = ops.readMigrations(bundle.migrations);
    const { pending, unknown } = await ops.migrationStatus(superUrl, bundle.migrations);
    if (unknown.length) {
      throw new Error(`This pharmacy data was updated by a newer version of Pharmacy CRM (${unknown[unknown.length - 1]}). Install that version or a newer one; nothing has been changed.`);
    }
    if (pending.length) {
      if (pending.length < all.length) {
        this.status("Backing up before updating the database");
        const { file } = await this.replica.snapshot("pre-update");
        log.info("backup before migrations", { file, pending });
      }
      this.status("Updating the database");
      const result = await ops.applyMigrations(superUrl, bundle.migrations, { log: (m) => log.info(m) });
      log.info("migrations applied", { applied: result.applied });
    }

    this.appPassword = random(24);
    await db.prepareAppLogin(password, this.appPassword);

    // Long-lived application secrets
    const jwtSecret = secrets.getOrCreate("jwtSecret", () => random(48)).value;
    const totpKey = secrets.getOrCreate("totpKey", () => random(48));
    if (totpKey.created && config.get("installedAt") && !this.events.includes("database-created")) {
      log.warn("two-factor encryption key was missing; existing two-factor enrolments must be redone with --recover-owner");
    }

    // Web server and worker
    const webPort = await this.choosePort("webPort", config.get("webPort") ?? 0);
    this.webPort = webPort;
    this.baseUrl = `http://127.0.0.1:${webPort}`;
    const env = {
      DEPLOY_MODE: "desktop",
      APP_VERSION: app.getVersion(),
      DATABASE_URL: superUrl,
      APP_DATABASE_URL: db.url(this.appPassword, { user: "pcrm_web" }),
      JWT_SECRET: jwtSecret,
      TOTP_ENCRYPTION_KEY: totpKey.value,
      APP_TIMEZONE: config.get("timezone") ?? "Asia/Karachi",
      DATA_DIR: paths.root,
      // plain http on loopback and on the shop network: browsers would drop Secure cookies there
      SESSION_COOKIE_SECURE: "0",
      ...this.ownerEnv(),
    };
    this.web = new ChildService({
      name: "web server",
      script: bundle.serverJs,
      cwd: bundle.server,
      env: { ...env, PORT: String(webPort), HOSTNAME: this.listenAddress(), LOG_SERVICE: "web" },
      logFile: path.join(paths.logs, "web.log"),
      ready: readyWhenHealthy(`${this.baseUrl}/api/health`),
      onExit: (code) => this.onChildExit(this.web, code),
    });
    this.worker = new ChildService({
      name: "worker",
      script: bundle.workerJs,
      cwd: bundle.server,
      // only the worker reads photos, so only the worker gets the cloud reader key
      env: { ...env, DATABASE_URL: superUrl, LOG_SERVICE: "worker", ...this.cloudOcrEnv() },
      logFile: path.join(paths.logs, "worker.log"),
      ipc: true,
      ready: readyWhenOutput("worker started"),
      onExit: (code) => this.onChildExit(this.worker, code),
    });
    this.status("Starting the app");
    await this.web.start();
    await this.worker.start();
    this.restarts = [];
    this.replica.startSchedule();
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

  /** 127.0.0.1 only, or every interface when shop network access is on (PostgreSQL never leaves loopback). */
  listenAddress() {
    return this.config.get("lanEnabled") ? "0.0.0.0" : "127.0.0.1";
  }

  async lanStatus({ refresh = false } = {}) {
    const enabled = Boolean(this.config.get("lanEnabled"));
    if (enabled && (refresh || !this.firewall)) this.firewall = process.env.PCRM_SKIP_FIREWALL === "1" ? "unknown" : await firewallState(this.webPort);
    return { enabled, port: this.webPort, urls: enabled ? lanAddresses().map((ip) => `http://${ip}:${this.webPort}`) : [], firewall: enabled ? this.firewall : "unknown" };
  }

  /**
   * Turns shop network access on or off: the web server restarts on the new address. Turning it on asks
   * Windows (administrator prompt) for a firewall rule when there is none for this port. Turning it off
   * leaves the rule: nothing listens on the network any more.
   */
  async setLanAccess(enabled) {
    this.config.set({ lanEnabled: Boolean(enabled) });
    this.log.info(enabled ? "shop network access on" : "shop network access off");
    await this.web.stop();
    this.web.env.HOSTNAME = this.listenAddress();
    await this.web.start();
    if (enabled && process.env.PCRM_SKIP_FIREWALL !== "1" && (await firewallState(this.webPort)) !== "allowed") {
      const added = await allowThroughFirewall(this.webPort, process.execPath);
      this.log.info(added ? "firewall rule added" : "firewall rule not added (administrator prompt declined)");
    }
    return this.lanStatus({ refresh: true });
  }

  /** The cloud photo reader's API key (Windows DPAPI protected), as worker environment. */
  cloudOcrEnv() {
    const key = this.secrets.get("cloudOcrKey");
    return key ? { ANTHROPIC_API_KEY: key } : {};
  }

  cloudOcrStatus() {
    return { configured: Boolean(this.secrets.get("cloudOcrKey")) };
  }

  /** Stores or removes the cloud reader key and restarts the worker with it. */
  async setCloudOcrKey(key) {
    if (key) this.secrets.set("cloudOcrKey", key);
    else this.secrets.remove("cloudOcrKey");
    this.log.info(key ? "cloud photo reader key saved" : "cloud photo reader key removed");
    await this.worker.stop();
    const { ANTHROPIC_API_KEY: _old, ...rest } = this.worker.env;
    this.worker.env = { ...rest, ...this.cloudOcrEnv() };
    await this.worker.start();
    return this.cloudOcrStatus();
  }

  versionInfo() {
    return { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node };
  }

  /** The recovery key for the current backup key, as people write it down. */
  recoveryKey() {
    return this.ops.formatRecoveryKey(this.backupKey);
  }

  /** Backup keys this installation can use without asking: the current one and earlier ones. */
  knownKeys() {
    const keys = [];
    const current = this.secrets.get("backupKey");
    if (current) keys.push(Buffer.from(current, "base64"));
    for (const k of JSON.parse(this.secrets.get("backupKeyHistory") ?? "[]")) keys.push(Buffer.from(k, "base64"));
    return keys;
  }

  /** Keeps a replaced backup key, so backups made with it still open without the old recovery key. */
  rememberKey(key) {
    if (!key) return;
    const history = JSON.parse(this.secrets.get("backupKeyHistory") ?? "[]");
    const b64 = key.toString("base64");
    if (!history.includes(b64)) this.secrets.set("backupKeyHistory", JSON.stringify([b64, ...history].slice(0, 10)));
  }

  /** What the restore screens show about a backup file, without decrypting it. */
  inspectBackup(file) {
    const { header, size } = this.ops.readBackupHeader(file);
    const key = this.knownKeys().find((k) => this.ops.keyId(k) === header.keyId) ?? null;
    return { file, name: path.basename(file), createdAt: header.createdAt, size, needsKey: key === null, key };
  }

  /** Snapshots found in the backups folder and the mirror folder, newest first. */
  availableBackups() {
    const seen = new Set();
    const found = [];
    for (const [source, dir] of [["backups", this.paths.backups], ["mirror", this.config.get("mirrorDir")]]) {
      if (!dir) continue;
      for (const b of listBackups(dir)) {
        if (seen.has(b.name)) continue;
        seen.add(b.name);
        found.push({ ...b, source });
      }
    }
    return found.sort((a, b) => b.at - a.at);
  }

  /**
   * Restores a backup into a side database and swaps it in only when it is complete and checked, so a
   * failed restore leaves the current data untouched. The web server and worker must be stopped.
   * key: the backup's key, from knownKeys() or typed in as a recovery key.
   */
  async restoreDatabase(file, key, onProgress = () => {}) {
    const { db, ops, password, log } = this;
    log.info("restore started", { file });
    await db.dropDatabase(password, RESTORE_DB);
    await db.createDatabase(password, RESTORE_DB);
    let result;
    try {
      result = await ops.restoreBackup(db.url(password, { database: RESTORE_DB }), file, key, this.bundle.migrations, {
        log: (m) => {
          log.info(`restore: ${m}`);
          onProgress(m);
        },
      });
    } catch (e) {
      await db.dropDatabase(password, RESTORE_DB).catch(() => {});
      log.error("restore failed", { file, error: String(e?.message ?? e) });
      throw e;
    }
    onProgress("switching to the restored data");
    await db.swapIn(password, RESTORE_DB);
    // The key that opened this backup becomes the installation's key: the recovery key people already
    // hold keeps working. The replaced key is remembered for the backups made with it.
    const current = this.secrets.get("backupKey");
    if (current !== key.toString("base64")) {
      if (current) this.rememberKey(Buffer.from(current, "base64"));
      this.secrets.set("backupKey", key.toString("base64"));
      this.config.set({ recoveryKeyShown: true });
    }
    this.backupKey = key;
    log.info("restore finished", { file, createdAt: result.manifest.createdAt, migratedAfter: result.migratedAfter });
    this.note("restored");
    return result;
  }

  /** An audit row written directly, for events the web server cannot record itself (after a restore). */
  async auditDirect({ actorId, action, after }) {
    await this.db.withClient(this.password, DB_NAME, (c) =>
      c.query(`INSERT INTO "AuditLog" (realm, "actorId", action, entity, "entityId", after) VALUES ('PLATFORM', $1, $2, 'Installation', 'desktop', $3)`, [actorId, action, JSON.stringify(after)]),
    );
  }

  /**
   * Restore on a running installation (Developer console): a snapshot of the current data first, then the
   * restore with the web server and worker stopped, then everything starts again.
   */
  async restoreRunning(file, key, onProgress = () => {}) {
    if (this.state !== "running") throw new Error("The app is not ready for a restore.");
    this.state = "restoring";
    this.replica.stopSchedule();
    try {
      onProgress("saving a backup of the current data");
      await this.replica.running?.catch(() => {});
      await this.replica.snapshot("pre-restore");
      onProgress("stopping the app");
      await this.worker.stop();
      await this.web.stop();
      try {
        return await this.restoreDatabase(file, key, onProgress);
      } finally {
        onProgress("starting the app");
        await this.db.prepareAppLogin(this.password, this.appPassword);
        await this.web.start();
        await this.worker.start();
      }
    } finally {
      this.state = "running";
      this.replica.startSchedule();
    }
  }

  /** backup: false skips the closing snapshot (the updater has just taken one). */
  async stop({ backup = true } = {}) {
    if (this.state === "stopping" || this.state === "stopped") return;
    const previous = this.state;
    this.state = "stopping";
    const log = this.log;
    log?.info("stopping", { from: previous });
    this.replica?.stopSchedule();
    await this.worker?.stop().catch((e) => log?.error("worker stop failed", { error: String(e) }));
    await this.web?.stop().catch((e) => log?.error("web server stop failed", { error: String(e) }));
    if (backup && (previous === "running" || previous === "failed") && this.replica) {
      // nothing writes any more: this snapshot holds the last change of the session
      this.status("Saving a backup");
      await this.replica.running?.catch(() => {});
      await this.replica.snapshot("on-close").catch(() => {}); // logged and recorded by the replica
    }
    await this.db?.stop().catch((e) => log?.error("PostgreSQL stop failed", { error: String(e) }));
    log?.info("stopped");
    this.state = "stopped";
    await log?.close();
  }
}
