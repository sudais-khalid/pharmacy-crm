/**
 * Shows the recovery key once, when a backup key is created (first start, or after the old key was lost).
 * The page has no Node access; confirming sets the document title, which the main process watches.
 * Until it is confirmed, the key is shown again at the next start.
 */
import { BrowserWindow } from "electron";
import { appIcon } from "./splash.mjs";

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(recoveryKey) {
  const groups = recoveryKey.split("-").map((g) => `<span>${escape(g)}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Recovery key</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  body{margin:0;padding:28px 32px;font-family:"Segoe UI",system-ui,sans-serif;color:#12312f;background:#fff}
  h1{font-size:20px;margin:0 0 8px}
  p{font-size:14px;line-height:1.5;margin:0 0 12px;color:#304b49}
  .key{display:grid;grid-template-columns:repeat(5,auto);gap:8px 14px;justify-content:start;margin:18px 0 20px;padding:16px 18px;border:2px dashed #1f7f78;border-radius:8px;font:600 20px/1.2 Consolas,"Cascadia Mono",monospace;letter-spacing:1px}
  .actions{display:flex;gap:10px;margin-top:18px}
  button{font:600 14px "Segoe UI",sans-serif;padding:9px 16px;border-radius:6px;border:1px solid #1f7f78;background:#fff;color:#1f7f78;cursor:pointer}
  button.primary{background:#1f7f78;color:#fff}
  button:disabled{opacity:.5;cursor:default}
  label{font-size:14px;display:flex;gap:8px;align-items:center;margin-top:6px}
  @media print{.actions,label{display:none}body{padding:0}}
</style></head><body>
<h1>Write down your recovery key</h1>
<p>Pharmacy CRM keeps encrypted backups of all pharmacy data on this computer. If this computer is replaced or Windows is reinstalled, these backups can only be restored with this key.</p>
<p>Write it on paper or print it, and keep it somewhere safe away from this computer. It is shown only once.</p>
<div class="key">${groups}</div>
<label><input type="checkbox" id="done"> I have written down or printed the recovery key</label>
<div class="actions">
  <button onclick="window.print()">Print</button>
  <button class="primary" id="close" disabled onclick="document.title='confirmed'">Continue</button>
</div>
<script>document.getElementById("done").onchange=(e)=>{document.getElementById("close").disabled=!e.target.checked};</script>
</body></html>`;
}

/** Resolves true when confirmed, false when the window was closed without confirming. */
export function showRecoveryKey(parent, recoveryKey) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent,
      modal: Boolean(parent),
      width: 640,
      height: 520,
      resizable: false,
      minimizable: false,
      title: "Recovery key",
      icon: appIcon(64),
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    let confirmed = false;
    win.on("page-title-updated", (event, title) => {
      event.preventDefault();
      if (title === "confirmed") {
        confirmed = true;
        win.close();
      }
    });
    win.on("closed", () => resolve(confirmed));
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(recoveryKey))}`);
  });
}
