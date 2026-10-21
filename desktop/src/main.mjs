/**
 * Electron main process: one instance per PC, a splash while the supervisor starts everything, then the
 * app window and a tray icon. Closing the window quits the app, which stops the worker, the web server
 * and PostgreSQL in that order.
 *
 *   --recover-owner  new password for the Developer account (Windows administrators only), then quit
 *   --selftest   start hidden, check health, write logs\selftest.json and quit (used by tests and CI).
 *                On a new data folder PCRM_SELFTEST_FIRST_START picks "fresh" (default) or "latest" (restore
 *                the newest backup, with PCRM_SELFTEST_RECOVERY_KEY when the key is not held here).
 *                PCRM_SELFTEST_CLIENT_URL runs it in client mode against that server instead.
 *
 * A PC without pharmacy data asks once whether it runs the pharmacy or connects to the one that does
 * (client mode: only the window, see client.mjs).
 */
import { app, BrowserWindow, Menu, Notification, Tray, dialog, shell } from "electron";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chooseMode, isPharmacyServer, normalizeServerUrl, readClientConfig, saveClientConfig, showLanAddresses } from "./client.mjs";
import { installConsoleBridge } from "./console-bridge.mjs";
import { keyFor, runFirstStart } from "./first-start.mjs";
import { consoleScenario, developerSignIn } from "./selftest-console.mjs";
import { explainNotAdmin, isElevatedAdmin, recoverOwner, relaunchElevated, showRecovered } from "./recover-owner.mjs";
import { showRecoveryKey } from "./recovery.mjs";
import { lanAddresses } from "./network.mjs";
import { layout } from "./paths.mjs";
import { appIcon, showSplash } from "./splash.mjs";
import { Supervisor } from "./supervisor.mjs";
import { startUpdater } from "./updater.mjs";

const SELFTEST = process.argv.includes("--selftest");
// The self-test walks the screens of a first start on a new PC (run it here, start fresh, recovery key)
// instead of skipping them, when PCRM_SELFTEST_CHOOSE=server.
const DRIVE_SCREENS = SELFTEST && process.env.PCRM_SELFTEST_CHOOSE === "server";
const RECOVER_OWNER = process.argv.includes("--recover-owner");
// Only a throwaway data folder (PCRM_DATA_DIR) may have test markers written or the recovery key reported.
const TEST_FOLDER = SELFTEST && Boolean(process.env.PCRM_DATA_DIR);
const here = path.dirname(fileURLToPath(import.meta.url));
// a separate profile (and single-instance lock): lets the self-test run a client next to a server
if (process.env.PCRM_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.PCRM_USER_DATA_DIR));

let supervisor;
let win = null;
let tray = null;
let quitting = false;
let updateReady = null; // version downloaded and ready to install
let installUpdate = null;
let updating = false; // everything is stopped and backed up; the installer takes over
// Until the app window is open, windows come and go (the mode choice closes before the splash opens), and
// closing the last of them must not quit the app. Cancelling a step quits explicitly instead.
let started = false;
let appUrl = null; // the local server, once it runs

/** bridge: the desktop controls for the Developer console, only on the computer that runs the pharmacy. */
function openWindow(baseUrl, { bridge = true } = {}) {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "Pharmacy CRM",
    icon: appIcon(64),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, ...(bridge ? { preload: path.join(here, "preload-app.cjs") } : {}) },
  });
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === baseUrl;
    } catch {
      return false;
    }
  };
  // Pages of the app (bills to print, for example) may open in a window; anything else opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: appIcon(64) } };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!sameOrigin(url)) event.preventDefault();
  });
  win.once("ready-to-show", () => {
    if (!SELFTEST) {
      win.maximize();
      win.show();
    }
  });
  win.on("closed", () => (win = null));
  started = true;
  return win.loadURL(baseUrl);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: appIcon(64) }).show();
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "never");

async function backupNow() {
  try {
    const r = await supervisor.replica.snapshot("manual");
    const mirrored = r.mirror ? (r.mirror.ok ? " and copied to the mirror folder" : `, but the mirror folder could not be reached`) : "";
    notify("Backup saved", `Saved in the backups folder${mirrored}.`);
  } catch (e) {
    notify("Backup failed", String(e?.message ?? e));
  }
  refreshTray();
}

async function chooseMirror() {
  const r = await dialog.showOpenDialog(win ?? undefined, {
    title: "Choose a second place for backups",
    message: "Pick a folder on another drive, a USB stick or a synced cloud folder.",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return;
  supervisor.config.set({ mirrorDir: r.filePaths[0] });
  await backupNow();
}

function refreshTray() {
  if (!tray) return;
  const last = supervisor.config.get("lastBackup");
  const failed = supervisor.config.get("lastBackupError");
  const mirror = supervisor.config.get("mirrorDir");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Pharmacy CRM", click: showWindow },
      // the Developer console (pharmacies, accounts, this computer's backups); it asks for the Developer sign-in
      { label: "Open Developer console", click: () => { showWindow(); void win?.loadURL(`${appUrl}/platform`); } },
      ...(updateReady ? [{ label: `Restart to install version ${updateReady}`, click: () => void installUpdate?.(() => (updating = true)) }] : []),
      { type: "separator" },
      { label: `Last backup: ${when(last?.at)}`, enabled: false },
      ...(failed ? [{ label: `Last attempt failed: ${when(failed.at)}`, enabled: false }] : []),
      { label: "Back up now", click: () => void backupNow() },
      { label: mirror ? `Mirror folder: ${mirror}` : "Also copy backups to a folder...", click: () => void chooseMirror() },
      ...(mirror ? [{ label: "Stop copying to the mirror folder", click: () => (supervisor.config.set({ mirrorDir: null }), refreshTray()) }] : []),
      { label: "Open backups folder", click: () => void shell.openPath(supervisor.paths.backups) },
      { type: "separator" },
      ...(supervisor.config.get("lanEnabled") ? [{ label: "Address for tablets...", click: async () => void showLanAddresses((await supervisor.lanStatus()).urls) }] : []),
      { label: "Open data folder", click: () => void shell.openPath(supervisor.paths.root) },
      { label: "Open logs folder", click: () => void shell.openPath(supervisor.paths.logs) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

function createTray() {
  tray = new Tray(appIcon(32));
  tray.setToolTip("Pharmacy CRM");
  tray.on("click", showWindow);
  tray.on("right-click", refreshTray);
  refreshTray();
}

/** With shop network access on: the server answers on a network address, and sign-in cookies work there. */
async function lanReport(lan) {
  // with access off, probe the address it would have, which must not answer
  const ip = lanAddresses()[0];
  const url = lan.urls[0] ?? (ip ? `http://${ip}:${lan.port}` : null);
  if (!url) return { ...lan, reachable: null };
  const health = await fetch(`${url}/api/health`).then((r) => r.ok || r.status === 503).catch(() => false);
  const login = await fetch(`${url}/api/platform/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ email: process.env.PLATFORM_OWNER_EMAIL, password: process.env.PLATFORM_OWNER_PASSWORD }),
  }).catch(() => null);
  const cookie = login?.headers.get("set-cookie") ?? "";
  return { ...lan, reachable: health, loginStatus: login?.status ?? null, cookieSet: /pcrm_platform=/.test(cookie), cookieSecure: /;\s*secure/i.test(cookie) };
}

async function selftest(baseUrl) {
  const consoleResult = TEST_FOLDER && process.env.PCRM_SELFTEST_CONSOLE === "1" ? await consoleScenario({ win, baseUrl, supervisor }) : undefined;
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  const listen = await supervisor.db.withClient(supervisor.secrets.get("dbPassword"), "postgres", async (c) => (await c.query("SHOW listen_addresses")).rows[0].listen_addresses);
  // counts self-test runs in a setting of the maintenance database, to prove data survives restarts
  const runs = await supervisor.db.withClient(supervisor.secrets.get("dbPassword"), "postgres", async (c) => {
    const n = Number((await c.query("SELECT coalesce(current_setting('pcrm.selftest_runs', true), '0') AS n")).rows[0].n) + 1;
    await c.query(`ALTER DATABASE postgres SET pcrm.selftest_runs = '${n}'`);
    return n;
  });
  // and one audit row per run in the pharmacy database, which backups carry
  const markers = !TEST_FOLDER
    ? null
    : await supervisor.db.withClient(supervisor.secrets.get("dbPassword"), "pharmacy_crm", async (c) => {
        await c.query(`INSERT INTO "AuditLog" (realm, action, entity, "entityId") VALUES ('PLATFORM', 'selftest.run', 'Installation', 'desktop')`);
        return Number((await c.query(`SELECT count(*) AS n FROM "AuditLog" WHERE action = 'selftest.run'`)).rows[0].n);
      });
  const login = await fetch(`${baseUrl}/login`);
  const report = {
    // low disk space only makes health "degraded"; the self-test is about the app itself
    ok: health.checks?.database?.ok === true && health.checks?.worker?.ok === true && login.ok,
    events: supervisor.events,
    baseUrl,
    pgPort: supervisor.db.port,
    listenAddresses: listen,
    selftestRuns: runs,
    auditMarkers: markers,
    recoveryKey: TEST_FOLDER ? supervisor.recoveryKey() : undefined,
    console: consoleResult,
    lan: TEST_FOLDER ? await lanReport(await supervisor.lanStatus()) : undefined,
    health,
    loginStatus: login.status,
    windowTitle: win?.getTitle(),
    // after moving to a new computer: the Developer signs in with the authenticator set up on the old one
    developerTotp: TEST_FOLDER && process.env.PCRM_SELFTEST_TOTP_SECRET ? await developerSignIn(baseUrl, process.env.PCRM_SELFTEST_TOTP_SECRET) : undefined,
    // the setup screens answered on the way in, and whether the recovery key is now marked as written down
    screens: screensSeen,
    // on a new installation the app window must lead the Developer to the console (no pharmacy code exists yet)
    firstScreen: DRIVE_SCREENS ? await firstScreenText() : undefined,
    recoveryKeyConfirmed: supervisor.config.get("recoveryKeyShown") === true,
  };
  writeFileSync(path.join(supervisor.paths.logs, "selftest.json"), JSON.stringify(report, null, 2));
  return report.ok;
}

/**
 * Presses the buttons of the app's own setup screens (data: pages, never the pharmacy app) the way a
 * person does: "Run Pharmacy CRM on this computer", "Start fresh", then ticks "I have written down the
 * recovery key" and presses Continue. Each screen is answered once.
 */
function clickThroughScreens() {
  const press = `(() => {
    for (const id of ["server", "fresh"]) { const b = document.getElementById(id); if (b) { b.click(); return id; } }
    const done = document.getElementById("done");
    if (done) { done.click(); document.getElementById("close").click(); return "recovery-key"; }
    return null;
  })()`;
  app.on("browser-window-created", (_event, w) => {
    w.webContents.on("did-finish-load", () => {
      if (!w.webContents.getURL().startsWith("data:")) return;
      // a moment for the page script to wire its buttons, as a person would take
      setTimeout(() => void w.webContents.executeJavaScript(press).then((what) => what && screensSeen.push(what)).catch(() => {}), 300);
    });
  });
}
const screensSeen = [];

/** What the app window shows once its page has rendered (waits up to 20 s on a slow machine). */
async function firstScreenText() {
  for (let i = 0; i < 80; i++) {
    const text = await win.webContents.executeJavaScript("document.body?.innerText ?? ''").catch(() => "");
    if (/Developer console/.test(text)) return text.slice(0, 400);
    await new Promise((ok) => setTimeout(ok, 250));
  }
  return await win.webContents.executeJavaScript("document.body?.innerText ?? ''").catch(() => "");
}

/** Shows the recovery key until it is confirmed (first start, or after the old key was lost). */
async function confirmRecoveryKey() {
  if (supervisor.config.get("recoveryKeyShown") !== false) return null;
  const confirmed = await showRecoveryKey(win, supervisor.recoveryKey());
  if (confirmed) supervisor.config.set({ recoveryKeyShown: true });
  return confirmed;
}

/** Unattended first start for the self-test. */
async function selftestFirstStart(sup) {
  if ((process.env.PCRM_SELFTEST_FIRST_START ?? "fresh") !== "latest") return;
  const latest = sup.availableBackups()[0];
  if (!latest) throw new Error("selftest: no backup to restore");
  const info = sup.inspectBackup(latest.file);
  await sup.restoreDatabase(latest.file, keyFor(sup, info, process.env.PCRM_SELFTEST_RECOVERY_KEY ?? null));
}

/** --recover-owner: database only, no web server; the result is shown once. */
async function bootRecovery() {
  // the self-test cannot answer the Windows prompt; it runs elevated-equivalent on a throwaway folder
  const admin = (TEST_FOLDER && process.env.PCRM_SELFTEST_ASSUME_ADMIN === "1") || (await isElevatedAdmin());
  if (!admin) {
    if (!SELFTEST && (await explainNotAdmin())) relaunchElevated();
    process.exitCode = SELFTEST ? 1 : 0;
    app.quit();
    return;
  }
  supervisor = new Supervisor({ echoLogs: !app.isPackaged });
  try {
    const result = await recoverOwner(supervisor);
    if (SELFTEST) writeFileSync(path.join(supervisor.paths.logs, "selftest.json"), JSON.stringify({ ok: true, recovered: result }, null, 2));
    else await showRecovered(result);
  } catch (e) {
    if (SELFTEST) console.error(e);
    else dialog.showErrorBox("Recovery failed", `${e.message}\n\nLogs: ${supervisor.paths.logs}`);
    process.exitCode = 1;
  }
  app.quit();
}

/** Keeps a self-test server running for a while, so a client self-test can connect to it. */
const stay = () => new Promise((ok) => setTimeout(ok, Number(process.env.PCRM_SELFTEST_STAY ?? 0) * 1000));

/** Client mode: only the window onto the pharmacy computer. */
async function bootClient(serverUrl) {
  let url = serverUrl;
  if (!(await isPharmacyServer(url))) {
    try {
      url = (await chooseMode({ reconnect: true, address: url })).serverUrl;
    } catch {
      app.quit();
      return;
    }
  }
  await openWindow(url, { bridge: false });
  const reconnect = async () => {
    try {
      const r = await chooseMode({ reconnect: true, address: url });
      url = r.serverUrl;
      await win?.loadURL(url);
    } catch {
      // closed: stay as it is
    }
  };
  win.webContents.on("did-fail-load", (_e, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame) void reconnect();
  });
  tray = new Tray(appIcon(32));
  tray.setToolTip(`Pharmacy CRM (${url})`);
  tray.on("click", showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Pharmacy CRM", click: showWindow },
    { label: "Connect to another pharmacy computer...", click: () => void reconnect() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
}

async function selftestClient() {
  const given = normalizeServerUrl(process.env.PCRM_SELFTEST_CLIENT_URL ?? "");
  if (given && (await isPharmacyServer(given))) saveClientConfig(given);
  const url = readClientConfig()?.serverUrl;
  const report = { mode: "client", serverUrl: url ?? null, reachable: url ? await isPharmacyServer(url) : false };
  if (report.reachable) {
    await openWindow(url, { bridge: false });
    report.page = win.webContents.getURL();
    report.desktopControls = await win.webContents.executeJavaScript("typeof window.pcrmDesktop");
    report.login = (await fetch(`${url}/login`)).status;
  }
  report.ok = report.reachable && report.desktopControls === "undefined" && report.login === 200;
  writeFileSync(path.join(app.getPath("userData"), "selftest.json"), JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
  app.quit();
}

async function boot() {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  if (SELFTEST && process.env.PCRM_SELFTEST_CLIENT_URL !== undefined) return selftestClient();
  if (DRIVE_SCREENS) clickThroughScreens();
  if ((!SELFTEST || DRIVE_SCREENS) && !existsSync(path.join(layout().pgdata, "PG_VERSION"))) {
    const saved = readClientConfig();
    if (saved) return bootClient(saved.serverUrl);
    let choice;
    try {
      choice = await chooseMode();
    } catch {
      app.quit();
      return;
    }
    if (choice.mode === "client") return bootClient(choice.serverUrl);
  }
  return bootServer();
}

async function bootServer() {
  const splash = await showSplash({ show: !SELFTEST });
  supervisor = new Supervisor({ status: (t) => splash.status(t), echoLogs: !app.isPackaged, firstStart: SELFTEST && !DRIVE_SCREENS ? selftestFirstStart : runFirstStart });
  supervisor.onFailure = (e) => {
    dialog.showErrorBox("Pharmacy CRM stopped working", `${e.message}\n\nClose and open the app again. If this keeps happening, send the logs folder to support.`);
    app.quit();
  };
  try {
    const baseUrl = await supervisor.start();
    appUrl = baseUrl;
    splash.status("Opening");
    installConsoleBridge({ supervisor, baseUrl, getWindow: () => win, onRestored: () => win?.loadURL(`${baseUrl}/platform/desktop`) });
    await openWindow(baseUrl);
    splash.close();
    if (SELFTEST) {
      if (DRIVE_SCREENS) await confirmRecoveryKey();
      const ok = await selftest(baseUrl).catch((e) => {
        supervisor.log.error("selftest failed", { error: String(e?.stack ?? e) });
        return false;
      });
      process.exitCode = ok ? 0 : 1;
      await stay();
      app.quit();
      return;
    }
    createTray();
    installUpdate = startUpdater({
      supervisor,
      onReady: (version) => {
        updateReady = version;
        refreshTray();
        notify("Update ready", `Pharmacy CRM ${version} is ready. Choose "Restart to install" in the tray menu when the counter is free; a backup is taken first.`);
      },
    });
    await confirmRecoveryKey();
  } catch (e) {
    splash.close();
    supervisor.log?.error("start failed", { error: String(e?.stack ?? e) });
    if (!SELFTEST) dialog.showErrorBox("Pharmacy CRM could not start", `${e.message}\n\nLogs: ${supervisor.paths.logs}`);
    else console.error(e);
    process.exitCode = 1;
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  if (RECOVER_OWNER) {
    app.whenReady().then(() => {
      dialog.showErrorBox("Pharmacy CRM is open", "Close Pharmacy CRM first (also from the icon next to the clock), then run the recovery again.");
      app.exit(1);
    });
  } else {
    app.quit();
  }
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(RECOVER_OWNER ? bootRecovery : boot);
  app.on("window-all-closed", () => {
    if (started) app.quit();
  });
  app.on("before-quit", (event) => {
    if (updating) return;
    // every quit request waits for the shutdown below, which ends with app.exit()
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    tray?.destroy();
    const closing = supervisor?.state === "running" && !SELFTEST ? showSplash() : Promise.resolve(null);
    closing
      .then((splash) => {
        if (splash) {
          splash.status("Closing");
          supervisor.status = (t) => splash.status(t);
        }
        return supervisor?.stop();
      })
      .catch(() => {})
      .finally(() => app.exit(process.exitCode ?? 0));
  });
}
