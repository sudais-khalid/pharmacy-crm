/**
 * Phase 0 proof of concept (roadmap task 0.12): the Electron main process acts as a supervisor that
 *   1. initialises and starts an embedded PostgreSQL 16 bound to 127.0.0.1,
 *   2. applies the Prisma migrations,
 *   3. starts the Next.js standalone server and the background worker with Electron's own Node,
 *   4. opens the app window once /api/health answers,
 *   5. shuts everything down gracefully.
 * With --poc it runs hidden, captures the login page, writes a timing report and quits.
 * Production hardening (DPAPI secrets, app_user roles, PROGRAMDATA paths, bundled migrations) is Phase 2.
 */
import { app, BrowserWindow } from "electron";
import { spawn, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const POC = process.argv.includes("--poc");
const FRESH = process.argv.includes("--fresh");
const DB_NAME = "pharmacy_crm";

const t0 = Date.now();
const timings = {};
const mark = (name) => (timings[name] = Date.now() - t0);
const log = (msg, extra = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), svc: "desktop", msg, ...extra }));

function freePort() {
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

/** Electron's executable doubles as a plain Node runtime for child processes. */
const nodeEnv = (extra) => ({ ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", ...extra });

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, shell: process.platform === "win32" });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${out}`))));
  });
}

async function waitForHealth(url, timeoutMs = 60_000) {
  const start = Date.now();
  let last = "no response";
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      last = `${r.status} ${await r.text()}`;
    } catch (e) {
      last = String(e?.cause ?? e);
    }
    if (Date.now() - start > timeoutMs) throw new Error(`no healthy answer from ${url}: ${last.slice(0, 800)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function dirSize(p) {
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, e.name);
    total += e.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

let pg, server, worker, win;

async function start() {
  const dataRoot = path.join(app.getPath("userData"), "poc-data");
  const pgDir = path.join(dataRoot, "pgdata");
  if (FRESH) rmSync(dataRoot, { recursive: true, force: true });
  mkdirSync(dataRoot, { recursive: true });
  const firstRun = !existsSync(path.join(pgDir, "PG_VERSION"));

  const pgPort = await freePort();
  const password = randomBytes(18).toString("base64url");
  pg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: "postgres",
    password,
    port: pgPort,
    persistent: true,
    authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "timezone=UTC"],
    onLog: () => {},
  });
  if (firstRun) {
    await pg.initialise();
    mark("pgInitialised");
  } else {
    // PoC only: a fresh random password needs a fresh cluster. Phase 2 keeps it in DPAPI storage.
    throw new Error("existing PoC data found; run with --fresh");
  }
  await pg.start();
  mark("pgStarted");
  await pg.createDatabase(DB_NAME).catch(() => {});
  const probe = pg.getPgClient();
  await probe.connect();
  const settings = {
    listenAddresses: (await probe.query("SHOW listen_addresses")).rows[0].listen_addresses,
    timezone: (await probe.query("SHOW timezone")).rows[0].TimeZone,
    serverVersion: (await probe.query("SHOW server_version")).rows[0].server_version,
  };
  await probe.end();
  const databaseUrl = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${pgPort}/${DB_NAME}?schema=public`;

  await run("npx", ["prisma", "migrate", "deploy"], { cwd: repo, env: { ...process.env, DATABASE_URL: databaseUrl } });
  mark("migrated");

  const webPort = await freePort();
  const standalone = path.join(repo, ".next", "standalone");
  const jwtSecret = randomBytes(48).toString("base64url");
  server = spawn(process.execPath, [path.join(standalone, "server.js")], {
    cwd: standalone,
    env: nodeEnv({ PORT: String(webPort), HOSTNAME: "127.0.0.1", DATABASE_URL: databaseUrl, JWT_SECRET: jwtSecret, APP_TIMEZONE: "Asia/Karachi" }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const serverLog = [];
  server.stdout.on("data", (d) => serverLog.push(String(d)));
  server.stderr.on("data", (d) => serverLog.push(String(d)));
  server.on("exit", (code) => log("web server exited", { code, output: serverLog.join("").slice(-3000) }));
  const base = `http://127.0.0.1:${webPort}`;
  const health = await waitForHealth(`${base}/api/health`);
  mark("webHealthy");

  worker = fork(path.join(repo, "dist", "worker.js"), [], {
    cwd: repo,
    execPath: process.execPath,
    env: nodeEnv({ DATABASE_URL: databaseUrl, APP_TIMEZONE: "Asia/Karachi", LOG_SERVICE: "worker" }),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker did not start")), 30_000);
    worker.stdout.on("data", (d) => {
      if (String(d).includes("worker started")) {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.on("exit", (code) => reject(new Error(`worker exited ${code}`)));
  });
  mark("workerStarted");

  win = new BrowserWindow({ width: 1280, height: 800, show: !POC, title: "Pharmacy CRM", webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadURL(`${base}/login`);
  mark("windowLoaded");

  if (POC) {
    await new Promise((r) => setTimeout(r, 1500));
    const image = await win.webContents.capturePage();
    const shot = path.join(here, "..", "poc-login.png");
    writeFileSync(shot, image.toPNG());
    const report = {
      firstRun,
      postgres: settings,
      timingsMs: timings,
      health,
      versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
      sizesMB: {
        electronDist: Math.round(dirSize(path.join(here, "..", "node_modules", "electron", "dist")) / 1e6),
        postgresBinaries: Math.round(dirSize(path.join(here, "..", "node_modules", "@embedded-postgres", "windows-x64")) / 1e6),
        nextStandalone: Math.round(dirSize(standalone) / 1e6),
        emptyDatabaseAfterMigrations: Math.round(dirSize(pgDir) / 1e6),
      },
      screenshot: shot,
    };
    await stop();
    report.timingsMs.shutdown = Date.now() - t0 - report.timingsMs.windowLoaded;
    writeFileSync(path.join(here, "..", "poc-report.json"), JSON.stringify(report, null, 2));
    log("poc report", report);
    app.exit(0);
  }
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (worker && worker.exitCode === null) {
    worker.send("shutdown");
    await Promise.race([new Promise((r) => worker.once("exit", r)), new Promise((r) => setTimeout(r, 15_000))]);
  }
  if (server && server.exitCode === null) server.kill();
  if (pg) await pg.stop().catch((e) => log("postgres stop failed", { error: String(e) }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(start).catch(async (e) => {
    log("start failed", { error: String(e?.stack ?? e) });
    await stop();
    app.exit(1);
  });
  app.on("before-quit", async (event) => {
    if (stopping) return;
    event.preventDefault();
    await stop();
    app.exit(0);
  });
}
