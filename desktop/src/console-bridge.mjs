/**
 * Main-process side of window.pcrmDesktop (preload-app.cjs): the desktop controls in the Developer
 * console. The server decides who may act. Each call must come from the app window on a /platform page,
 * and the window's Developer session (with its second factor) is checked by the web server, which also
 * writes the audit entry. Restore also needs a fresh authenticator code.
 */
import { dialog, ipcMain, shell } from "electron";
import { describeProgress, keyFor } from "./first-start.mjs";

export function installConsoleBridge({ supervisor, getWindow, baseUrl, onRestored }) {
  const allowed = new Map(); // id -> backup file the page may restore
  let nextId = 1;
  const register = (file) => {
    for (const [id, f] of allowed) if (f === file) return id;
    const id = String(nextId++);
    allowed.set(id, file);
    return id;
  };

  async function sessionCookie(event) {
    const win = getWindow();
    if (!win || event.sender !== win.webContents) throw new Error("Not allowed.");
    const url = new URL(event.senderFrame?.url ?? "about:blank");
    if (url.origin !== baseUrl || !url.pathname.startsWith("/platform")) throw new Error("Open the Developer console to use this.");
    const [cookie] = await win.webContents.session.cookies.get({ url: baseUrl, name: "pcrm_platform" });
    if (!cookie) throw new Error("Sign in to the Developer console first.");
    return `pcrm_platform=${cookie.value}`;
  }

  async function call(cookie, method, route, body) {
    const r = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { cookie, origin: baseUrl, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.error ?? "Not allowed.");
      e.fields = data.fields;
      throw e;
    }
    return data;
  }

  /** A Developer who has passed the second factor is signed in in this window. */
  async function requireDeveloper(event) {
    const cookie = await sessionCookie(event);
    const me = await call(cookie, "GET", "/api/platform/auth/me");
    if (me.step !== "done") throw new Error("Finish signing in to the Developer console first.");
    return cookie;
  }

  /** Asks the server to allow and record an action. */
  async function authorize(event, action, extra = {}) {
    const cookie = await requireDeveloper(event);
    return (await call(cookie, "POST", "/api/platform/desktop/authorize", { action, ...extra })).devId;
  }

  const status = async () => ({
    lan: await supervisor.lanStatus(),
    version: supervisor.versionInfo(),
    dataRoot: supervisor.paths.root,
    backupsDir: supervisor.paths.backups,
    mirrorDir: supervisor.config.get("mirrorDir") ?? null,
    lastBackup: supervisor.config.get("lastBackup") ?? null,
    lastBackupError: supervisor.config.get("lastBackupError") ?? null,
    backups: supervisor.availableBackups().slice(0, 15).map((b) => ({ id: register(b.file), name: b.name, createdAt: b.at.toISOString(), size: b.size, reason: b.reason, source: b.source })),
  });

  const handlers = {
    "desktop:status": async (event) => {
      await requireDeveloper(event);
      return await status();
    },
    "desktop:lan": async (event, enabled) => {
      await authorize(event, "lan", { detail: { enabled: Boolean(enabled) } });
      return supervisor.setLanAccess(Boolean(enabled));
    },
    "desktop:backup": async (event) => {
      await authorize(event, "backup");
      const r = await supervisor.replica.snapshot("manual");
      return { file: r.file, size: r.size, mirror: r.mirror };
    },
    "desktop:mirror-choose": async (event) => {
      await requireDeveloper(event);
      const r = await dialog.showOpenDialog(getWindow(), {
        title: "Choose a second place for backups",
        message: "Pick a folder on another drive, a USB stick or a synced cloud folder.",
        properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      await authorize(event, "mirror", { detail: { mirrorDir: r.filePaths[0] } });
      supervisor.config.set({ mirrorDir: r.filePaths[0] });
      await supervisor.replica.snapshot("manual").catch(() => {});
      return await status();
    },
    "desktop:mirror-clear": async (event) => {
      await authorize(event, "mirror", { detail: { mirrorDir: null } });
      supervisor.config.set({ mirrorDir: null });
      return await status();
    },
    "desktop:pick-file": async (event) => {
      await requireDeveloper(event);
      const r = await dialog.showOpenDialog(getWindow(), { title: "Choose a Pharmacy CRM backup", filters: [{ name: "Pharmacy CRM backup", extensions: ["pcrmbak"] }], properties: ["openFile"] });
      if (r.canceled || !r.filePaths[0]) return null;
      const info = supervisor.inspectBackup(r.filePaths[0]);
      return { id: register(info.file), name: info.name, createdAt: info.createdAt, size: info.size, needsKey: info.needsKey };
    },
    "desktop:restore": async (event, { id, recoveryKey, code } = {}) => {
      const file = allowed.get(String(id));
      if (!file) throw new Error("Choose a backup first.");
      await requireDeveloper(event);
      // the key is checked before the authenticator code is used, so a wrong key does not waste a code
      const info = supervisor.inspectBackup(file);
      const key = keyFor(supervisor, info, recoveryKey);
      const detail = { file: info.name, createdAt: info.createdAt };
      const devId = await authorize(event, "restore", { code, detail });
      const result = await supervisor.restoreRunning(file, key, (m) => event.sender.send("desktop:progress", describeProgress(m)));
      // the server's audit row went into the replaced data (and the pre-restore backup); record it again here
      await supervisor.auditDirect({ actorId: devId, action: "desktop.restore", after: { ...detail, migratedAfter: result.migratedAfter } }).catch((e) => supervisor.log.error("could not audit the restore", { error: String(e) }));
      setTimeout(onRestored, 300);
      return { createdAt: result.manifest.createdAt, migratedAfter: result.migratedAfter.length };
    },
    "desktop:open-folder": async (event, which) => {
      await requireDeveloper(event);
      const dir = { backups: supervisor.paths.backups, logs: supervisor.paths.logs, data: supervisor.paths.root, mirror: supervisor.config.get("mirrorDir") }[which];
      if (dir) await shell.openPath(dir);
      return null;
    },
  };

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return { ok: true, data: await fn(event, ...args) };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e), needsKey: Boolean(e?.needsKey), fields: e?.fields ?? null };
      }
    });
  }
}
