/**
 * First start on a new data folder (architecture, section 2.4): "Start fresh" or "Restore from a backup".
 * Backups in the backups folder and the mirror folder are offered automatically (newest first); a file
 * from a USB drive can be chosen. The recovery key is asked for only when the backup was made with a key
 * this installation does not hold.
 *
 * The page refers to backups by id. Only files listed here or picked in the file dialog can be restored.
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appIcon } from "./splash.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Turns the restore log into words for the screen. */
export function describeProgress(message) {
  if (message.startsWith("verifying")) return "Checking the backup file";
  if (message.startsWith("rebuilding")) return "Preparing the database";
  if (message.startsWith("loading ")) return `Loading ${message.slice(8)}`;
  if (message.startsWith("applying")) return "Updating the restored data to this version";
  if (message.startsWith("switching")) return "Finishing";
  if (message.startsWith("saving")) return "Saving a backup of the current data";
  if (message.startsWith("stopping")) return "Pausing the app";
  if (message.startsWith("starting")) return "Starting the app again";
  return message;
}

/** Resolves the backup key for a file: one this installation holds, or the typed recovery key. */
export function keyFor(supervisor, info, recoveryKey) {
  if (info.key) return info.key;
  if (!recoveryKey) {
    const e = new Error("This backup was made with a different key. Enter its recovery key.");
    e.needsKey = true;
    throw e;
  }
  const key = supervisor.ops.parseRecoveryKey(recoveryKey);
  if (supervisor.ops.keyId(key) !== supervisor.ops.readBackupHeader(info.file).header.keyId) {
    throw new Error("This recovery key does not belong to this backup. Check every group of characters.");
  }
  return key;
}

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Set up Pharmacy CRM</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:28px 32px;font-family:"Segoe UI",system-ui,sans-serif;color:#12312f;background:#fff;border-top:6px solid #1f7f78}
  h1{font-size:21px;margin:0 0 6px} h2{font-size:15px;margin:22px 0 8px}
  p{font-size:14px;line-height:1.5;margin:0 0 10px;color:#304b49}
  .list{border:1px solid #d6e5e3;border-radius:8px;max-height:190px;overflow:auto}
  .item{display:flex;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid #eef5f4;font-size:14px;cursor:pointer}
  .item:last-child{border-bottom:0} .item small{color:#5b7573;margin-left:auto}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
  button{font:600 14px "Segoe UI",sans-serif;padding:9px 16px;border-radius:6px;border:1px solid #1f7f78;background:#fff;color:#1f7f78;cursor:pointer}
  button.primary{background:#1f7f78;color:#fff} button:disabled{opacity:.5;cursor:default}
  #keybox{display:none;margin-top:14px} #keybox input{width:100%;font:600 15px Consolas,monospace;padding:9px 10px;border:1px solid #9cbcb9;border-radius:6px;text-transform:uppercase}
  #status{margin-top:14px;font-size:14px;min-height:20px;color:#1f7f78} #status.error{color:#b42318}
  .muted{color:#5b7573;font-size:13px}
  hr{border:0;border-top:1px solid #e3efee;margin:22px 0 16px}
</style></head><body>
<h1>Set up Pharmacy CRM on this computer</h1>
<p>Start with an empty database, or bring back all pharmacy data from a backup.</p>
<div id="found" hidden>
  <h2>Backups found on this computer</h2>
  <div class="list" id="list" role="radiogroup" aria-label="Backups"></div>
</div>
<div class="row">
  <button class="primary" id="restore" hidden>Restore the selected backup</button>
  <button id="file">Restore from a file...</button>
</div>
<div id="keybox">
  <p id="keytext">This backup was made on another computer or before Windows was reset. Enter its recovery key.</p>
  <input id="key" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-...">
  <div class="row"><button class="primary" id="withkey">Restore with this key</button></div>
</div>
<div id="status" role="status" aria-live="polite"></div>
<hr>
<p class="muted" id="freshnote">Start fresh if this is a new pharmacy installation.</p>
<button id="fresh">Start fresh</button>
<script>
  const $ = (id) => document.getElementById(id);
  let selected = null, busy = false;
  const fmt = (b) => new Date(b.createdAt).toLocaleString() + " (" + (b.size / 1048576).toFixed(1) + " MB)";
  const REASON = { scheduled: "scheduled", "on-close": "when the app closed", manual: "backed up by hand", "pre-update": "before an update", "pre-restore": "before a restore" };
  function setBusy(v) { busy = v; for (const b of document.querySelectorAll("button")) b.disabled = v; $("key").disabled = v; }
  function status(t, err) { $("status").textContent = t; $("status").className = err ? "error" : ""; }
  async function restore(id, key) {
    selected = id; setBusy(true); status("Starting the restore");
    const r = await window.pcrmSetup.restore(id, key);
    setBusy(false);
    if (r.ok) { status("Restored. Opening the app."); setBusy(true); return; }
    status(r.error, true);
    if (r.needsKey) { $("keybox").style.display = "block"; $("key").focus(); }
  }
  window.pcrmSetup.onProgress((t) => status(t));
  window.pcrmSetup.options().then((o) => {
    if (o.backups.length) {
      $("found").hidden = false; $("restore").hidden = false;
      $("freshnote").textContent = "Starting fresh ignores these backups. They stay in the backups folder.";
      o.backups.forEach((b, i) => {
        const el = document.createElement("label"); el.className = "item";
        el.innerHTML = '<input type="radio" name="b"><span></span><small></small>';
        el.querySelector("span").textContent = fmt(b) + (b.reason ? ", " + (REASON[b.reason] || b.reason) : "");
        el.querySelector("small").textContent = b.source === "mirror" ? "mirror folder" : "backups folder";
        const radio = el.querySelector("input"); radio.value = b.id; radio.checked = i === 0;
        $("list").appendChild(el);
      });
    }
  });
  $("restore").onclick = () => { const r = document.querySelector("input[name=b]:checked"); if (r) { $("keybox").style.display = "none"; restore(r.value, null); } };
  $("file").onclick = async () => { const f = await window.pcrmSetup.pickFile(); if (f) { $("keybox").style.display = "none"; status("Selected " + f.name + ", made " + fmt(f)); restore(f.id, null); } };
  $("withkey").onclick = () => restore(selected, $("key").value);
  $("key").onkeydown = (e) => { if (e.key === "Enter") restore(selected, $("key").value); };
  $("fresh").onclick = () => { if (!busy) { setBusy(true); window.pcrmSetup.startFresh(); } };
</script>
</body></html>`;

/** Shows the screen and resolves once the database is either left empty (fresh) or restored. */
export function runFirstStart(supervisor) {
  return new Promise((resolve, reject) => {
    const allowed = new Map(); // id -> file
    let nextId = 1;
    const register = (file) => {
      const id = String(nextId++);
      allowed.set(id, file);
      return id;
    };
    let done = false;
    const win = new BrowserWindow({
      width: 640,
      height: 620,
      resizable: false,
      title: "Set up Pharmacy CRM",
      icon: appIcon(64),
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(here, "preload-setup.cjs") },
    });
    const own = (event) => event.sender === win.webContents;
    const handlers = {
      "setup:options": () => ({
        backups: supervisor.availableBackups().slice(0, 20).map((b) => ({ id: register(b.file), createdAt: b.at.toISOString(), size: b.size, reason: b.reason, source: b.source })),
      }),
      "setup:pick-file": async () => {
        const r = await dialog.showOpenDialog(win, { title: "Choose a Pharmacy CRM backup", filters: [{ name: "Pharmacy CRM backup", extensions: ["pcrmbak"] }], properties: ["openFile"] });
        if (r.canceled || !r.filePaths[0]) return null;
        try {
          const info = supervisor.inspectBackup(r.filePaths[0]);
          return { id: register(info.file), name: info.name, createdAt: info.createdAt, size: info.size };
        } catch (e) {
          dialog.showErrorBox("Not a backup", `This file cannot be used: ${e.message}`);
          return null;
        }
      },
      "setup:restore": async (event, id, recoveryKey) => {
        const file = allowed.get(String(id));
        if (!file) return { ok: false, error: "Choose a backup first." };
        try {
          const info = supervisor.inspectBackup(file);
          const key = keyFor(supervisor, info, recoveryKey);
          await supervisor.restoreDatabase(file, key, (m) => event.sender.send("setup:progress", describeProgress(m)));
          finish();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message, needsKey: Boolean(e.needsKey) || /different key/.test(e.message) };
        }
      },
      "setup:fresh": () => {
        supervisor.log.info("first start: starting fresh");
        finish();
      },
    };
    for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args) => (own(event) ? fn(event, ...args) : null));
    const cleanup = () => Object.keys(handlers).forEach((c) => ipcMain.removeHandler(c));
    function finish() {
      done = true;
      cleanup();
      setTimeout(() => !win.isDestroyed() && win.destroy(), 400);
      resolve();
    }
    win.on("closed", () => {
      if (done) return;
      cleanup();
      reject(new Error("Setup was closed before a choice was made. Open the app again to continue."));
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  });
}
