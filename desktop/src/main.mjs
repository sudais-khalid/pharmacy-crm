/**
 * Electron main process: one instance per PC, a splash while the supervisor starts everything, then the
 * app window and a tray icon. Closing the window quits the app, which stops the worker, the web server
 * and PostgreSQL in that order.
 *
 *   --selftest   start hidden, check health, write logs\selftest.json and quit (used by tests and CI)
 */
import { app, BrowserWindow, Menu, Notification, Tray, dialog, shell } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { showRecoveryKey } from "./recovery.mjs";
import { appIcon, showSplash } from "./splash.mjs";
import { Supervisor } from "./supervisor.mjs";

const SELFTEST = process.argv.includes("--selftest");

let supervisor;
let win = null;
let tray = null;
let quitting = false;

function openWindow(baseUrl) {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "Pharmacy CRM",
    icon: appIcon(64),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
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
      { type: "separator" },
      { label: `Last backup: ${when(last?.at)}`, enabled: false },
      ...(failed ? [{ label: `Last attempt failed: ${when(failed.at)}`, enabled: false }] : []),
      { label: "Back up now", click: () => void backupNow() },
      { label: mirror ? `Mirror folder: ${mirror}` : "Also copy backups to a folder...", click: () => void chooseMirror() },
      ...(mirror ? [{ label: "Stop copying to the mirror folder", click: () => (supervisor.config.set({ mirrorDir: null }), refreshTray()) }] : []),
      { label: "Open backups folder", click: () => void shell.openPath(supervisor.paths.backups) },
      { type: "separator" },
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

async function selftest(baseUrl) {
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  const listen = await supervisor.db.withClient(supervisor.secrets.get("dbPassword"), "postgres", async (c) => (await c.query("SHOW listen_addresses")).rows[0].listen_addresses);
  // counts self-test runs in a setting of the maintenance database, to prove data survives restarts
  const runs = await supervisor.db.withClient(supervisor.secrets.get("dbPassword"), "postgres", async (c) => {
    const n = Number((await c.query("SELECT coalesce(current_setting('pcrm.selftest_runs', true), '0') AS n")).rows[0].n) + 1;
    await c.query(`ALTER DATABASE postgres SET pcrm.selftest_runs = '${n}'`);
    return n;
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
    health,
    loginStatus: login.status,
    windowTitle: win?.getTitle(),
  };
  writeFileSync(path.join(supervisor.paths.logs, "selftest.json"), JSON.stringify(report, null, 2));
  return report.ok;
}

async function boot() {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  const splash = await showSplash({ show: !SELFTEST });
  supervisor = new Supervisor({ status: (t) => splash.status(t), echoLogs: !app.isPackaged });
  supervisor.onFailure = (e) => {
    dialog.showErrorBox("Pharmacy CRM stopped working", `${e.message}\n\nClose and open the app again. If this keeps happening, send the logs folder to support.`);
    app.quit();
  };
  try {
    const baseUrl = await supervisor.start();
    splash.status("Opening");
    await openWindow(baseUrl);
    splash.close();
    if (SELFTEST) {
      const ok = await selftest(baseUrl).catch((e) => {
        supervisor.log.error("selftest failed", { error: String(e?.stack ?? e) });
        return false;
      });
      process.exitCode = ok ? 0 : 1;
      app.quit();
      return;
    }
    createTray();
    if (supervisor.config.get("recoveryKeyShown") === false) {
      const confirmed = await showRecoveryKey(win, supervisor.recoveryKey());
      if (confirmed) supervisor.config.set({ recoveryKeyShown: true });
    }
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
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(boot);
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
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
