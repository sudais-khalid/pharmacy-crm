/**
 * Client mode (architecture, section 2.3): on a second PC at the counter, the app is only a window onto
 * the pharmacy computer, with no database or server of its own. The server address is remembered per
 * device in client.json in the app's profile folder.
 */
import { BrowserWindow, app, ipcMain } from "electron";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { appIcon } from "./splash.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = () => path.join(app.getPath("userData"), "client.json");

export function readClientConfig() {
  try {
    return existsSync(configFile()) ? JSON.parse(readFileSync(configFile(), "utf8")) : null;
  } catch {
    return null;
  }
}
export const saveClientConfig = (serverUrl) => writeFileSync(configFile(), JSON.stringify({ serverUrl, savedAt: new Date().toISOString() }, null, 2));
export const clearClientConfig = () => rmSync(configFile(), { force: true });

/** "192.168.1.5:51234" or a full URL -> "http://192.168.1.5:51234"; null when it is not an address. */
export function normalizeServerUrl(text) {
  const t = String(text).trim();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `http://${t}`);
    if (!["http:", "https:"].includes(u.protocol) || !u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** True when a Pharmacy CRM server answers at the address (its health check, even if degraded). */
export async function isPharmacyServer(url) {
  try {
    const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) });
    const body = await r.json().catch(() => null);
    return (r.ok || r.status === 503) && typeof body?.checks === "object";
  } catch {
    return false;
  }
}

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Pharmacy CRM</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:28px 32px;font-family:"Segoe UI",system-ui,sans-serif;color:#12312f;background:#fff;border-top:6px solid #1f7f78}
  h1{font-size:21px;margin:0 0 6px} h2{font-size:15px;margin:0 0 6px}
  p{font-size:14px;line-height:1.5;margin:0 0 10px;color:#304b49}
  .option{border:1px solid #d6e5e3;border-radius:8px;padding:16px;margin-top:14px}
  input{width:100%;font:15px Consolas,monospace;padding:9px 10px;border:1px solid #9cbcb9;border-radius:6px}
  button{font:600 14px "Segoe UI",sans-serif;padding:9px 16px;border-radius:6px;border:1px solid #1f7f78;background:#fff;color:#1f7f78;cursor:pointer;margin-top:10px}
  button.primary{background:#1f7f78;color:#fff} button:disabled{opacity:.5}
  #status{margin-top:10px;font-size:14px;min-height:20px} #status.error{color:#b42318}
  .muted{color:#5b7573;font-size:13px}
</style></head><body>
<h1 id="title">Set up Pharmacy CRM on this computer</h1>
<p id="lead">Choose what this computer does.</p>
<div class="option" id="here">
  <h2>This computer runs the pharmacy</h2>
  <p>The pharmacy's data is kept and backed up on this computer. Choose this for the main counter PC.</p>
  <button class="primary" id="server">Run the pharmacy here</button>
</div>
<div class="option">
  <h2>Connect to the pharmacy computer</h2>
  <p>Use the pharmacy that runs on another computer in this shop. Its address is shown there under "This computer" in the Developer console, or in the tray menu as "Address for tablets".</p>
  <input id="address" placeholder="192.168.1.20:51234" autocomplete="off" spellcheck="false">
  <button class="primary" id="connect">Connect</button>
  <div id="status" role="status" aria-live="polite"></div>
</div>
<script>
  const $ = (id) => document.getElementById(id);
  window.pcrmMode.info().then((i) => {
    if (i.address) $("address").value = i.address;
    if (i.reconnect) {
      $("title").textContent = "Cannot reach the pharmacy computer";
      $("lead").textContent = "Check that it is switched on, Pharmacy CRM is open there, and both computers are on the shop network.";
      $("here").style.display = "none";
      $("connect").textContent = "Try again";
    }
  });
  async function connect() {
    for (const b of document.querySelectorAll("button")) b.disabled = true;
    $("status").className = ""; $("status").textContent = "Connecting";
    const r = await window.pcrmMode.connect($("address").value);
    if (!r.ok) { $("status").className = "error"; $("status").textContent = r.error; for (const b of document.querySelectorAll("button")) b.disabled = false; }
  }
  $("connect").onclick = connect;
  $("address").onkeydown = (e) => { if (e.key === "Enter") connect(); };
  $("server").onclick = () => window.pcrmMode.runHere();
</script></body></html>`;

/**
 * The mode screen: resolves { mode: "server" } or { mode: "client", serverUrl }. With reconnect, only the
 * connect part is shown (the saved server could not be reached).
 */
export function chooseMode({ reconnect = false, address = "" } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const win = new BrowserWindow({
      width: 640,
      height: reconnect ? 440 : 600,
      resizable: false,
      title: "Pharmacy CRM",
      icon: appIcon(64),
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(here, "preload-mode.cjs") },
    });
    const finish = (result) => {
      done = true;
      cleanup();
      win.destroy();
      resolve(result);
    };
    const handlers = {
      "mode:info": () => ({ reconnect, address: address.replace(/^http:\/\//, "") }),
      "mode:server": () => finish({ mode: "server" }),
      "mode:connect": async (_event, text) => {
        const url = normalizeServerUrl(text);
        if (!url) return { ok: false, error: "Enter the address shown on the pharmacy computer, for example 192.168.1.20:51234." };
        if (!(await isPharmacyServer(url))) return { ok: false, error: `No Pharmacy CRM answers at ${url}. Check the address and that both computers are on the same network.` };
        saveClientConfig(url);
        finish({ mode: "client", serverUrl: url });
        return { ok: true };
      },
    };
    for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, (event, ...args) => (event.sender === win.webContents ? fn(event, ...args) : null));
    const cleanup = () => Object.keys(handlers).forEach((c) => ipcMain.removeHandler(c));
    win.on("closed", () => {
      if (done) return;
      cleanup();
      reject(new Error("closed"));
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  });
}

/** The addresses tablets can use, each with a QR code to scan. */
export async function showLanAddresses(urls) {
  const codes = await Promise.all(urls.map((u) => QRCode.toString(u, { type: "svg", margin: 1 })));
  const items = urls.map((u, i) => `<div class="item"><div class="qr">${codes[i]}</div><div class="url">${u}</div></div>`).join("") || "<p>This computer is not connected to a network.</p>";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Address for tablets</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>body{margin:0;padding:24px 28px;font-family:"Segoe UI",system-ui,sans-serif;color:#12312f;border-top:6px solid #1f7f78}
h1{font-size:19px;margin:0 0 6px}p{font-size:14px;color:#304b49;margin:0 0 14px}.item{display:flex;align-items:center;gap:16px;margin-bottom:14px}
.qr{width:150px;height:150px}.qr svg{width:100%;height:100%}.url{font:600 18px Consolas,monospace}</style></head><body>
<h1>Open Pharmacy CRM on a tablet or another computer</h1>
<p>Connect it to the shop's Wi-Fi, then scan the code or type the address into the browser (or into Pharmacy CRM's "Connect to the pharmacy computer").</p>
${items}</body></html>`;
  const win = new BrowserWindow({ width: 560, height: 260 + urls.length * 170, title: "Address for tablets", icon: appIcon(64), autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, javascript: false } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return win;
}
