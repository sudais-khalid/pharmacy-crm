/**
 * Updates (architecture, section 2.3): an installed app checks its release feed at start and every six
 * hours, downloads a new version in the background and offers to install it. Installing first saves a
 * backup and shuts everything down cleanly, then runs the new installer silently, which keeps all data and
 * starts the app again; migrations run on that start, after another backup (supervisor.mjs).
 *
 * Builds without a feed (no app-update.yml next to the app) never check.
 */
import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
const SIX_HOURS = 6 * 60 * 60 * 1000;

export function updatesConfigured() {
  return app.isPackaged && existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

/**
 * onReady(version) is called when an update has been downloaded and can be installed.
 * Returns install(): backs up, stops the supervisor and runs the installer.
 */
export function startUpdater({ supervisor, onReady }) {
  if (!updatesConfigured()) return null;
  const log = supervisor.log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // only through install() below, after a backup
  autoUpdater.logger = { info: (m) => log.info(`updater: ${m}`), warn: (m) => log.warn(`updater: ${m}`), error: (m) => log.error(`updater: ${m}`), debug: () => {} };
  let ready = null;
  autoUpdater.on("update-downloaded", (info) => {
    ready = info.version;
    log.info("update downloaded", { version: info.version });
    onReady(info.version);
  });
  autoUpdater.on("error", (e) => log.warn("update check failed", { error: String(e?.message ?? e) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 30_000).unref?.();
  setInterval(check, SIX_HOURS).unref?.();

  return async function install(beforeQuit) {
    if (!ready) return;
    log.info("installing update", { version: ready });
    await supervisor.replica.snapshot("pre-update");
    await supervisor.stop({ backup: false }); // just backed up
    beforeQuit?.();
    autoUpdater.quitAndInstall(true, true);
  };
}
