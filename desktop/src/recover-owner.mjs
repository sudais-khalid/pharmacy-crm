/**
 * PharmacyCRM.exe --recover-owner (architecture, section 2.3): a new password for the Developer account
 * when the password or the authenticator is lost. Only a Windows administrator can run it, which is the
 * point: someone with only the app window cannot take the account over. Two-factor sign-in is removed
 * and must be set up again; every Developer session ends. The new password is shown once.
 */
import { BrowserWindow, app, dialog } from "electron";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { appIcon } from "./splash.mjs";

const run = promisify(execFile);
const system32 = (exe) => path.join(process.env.SystemRoot || "C:\\Windows", "System32", exe);

/** True when this process runs with administrator rights (elevated). */
export async function isElevatedAdmin() {
  try {
    await run(system32("net.exe"), ["session"], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Starts this app again with --recover-owner through the Windows administrator prompt. */
export function relaunchElevated() {
  const args = app.isPackaged ? ["--recover-owner"] : [app.getAppPath(), "--recover-owner"];
  const quoted = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
  const command = `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList ${quoted} -Verb RunAs`;
  spawn(system32("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", command], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** Runs the recovery against the installation's database; returns { email, password }. */
export async function recoverOwner(supervisor) {
  await supervisor.openDatabase();
  const opsJs = path.join(supervisor.bundle.server, "dist", "ops.js");
  try {
    const { stdout } = await run(process.execPath, [opsJs, "recover-owner", "--json"], {
      cwd: supervisor.bundle.server,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", DATABASE_URL: supervisor.superUrl },
      windowsHide: true,
    });
    const result = JSON.parse(stdout.trim().split("\n").pop());
    supervisor.log.info("Developer account recovered", { email: result.email });
    return result;
  } catch (e) {
    const message = String(e?.stderr || e?.message || e).trim();
    supervisor.log.error("Developer account recovery failed", { error: message });
    throw new Error(message);
  }
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Shows the new password once. Resolves when the window is closed. */
export function showRecovered({ email, password }) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Developer account recovered</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  body{margin:0;padding:28px 32px;font-family:"Segoe UI",system-ui,sans-serif;color:#12312f;border-top:6px solid #1f7f78}
  h1{font-size:20px;margin:0 0 10px} p{font-size:14px;line-height:1.5;color:#304b49;margin:0 0 10px}
  .pw{font:600 20px Consolas,monospace;padding:12px 14px;border:2px dashed #1f7f78;border-radius:8px;user-select:all;margin:14px 0}
  button{font:600 14px "Segoe UI",sans-serif;padding:9px 16px;border-radius:6px;border:1px solid #1f7f78;background:#1f7f78;color:#fff;cursor:pointer}
</style></head><body>
<h1>Developer account recovered</h1>
<p>Account: <strong>${escape(email)}</strong></p>
<p>New password, shown only once:</p>
<div class="pw" id="pw">${escape(password)}</div>
<p>Sign in to the Developer console with it, set up two-factor sign-in again, then change the password. Earlier sessions have been signed out.</p>
<button id="copy">Copy password</button>
<script>document.getElementById("copy").onclick=()=>{const r=document.createRange();r.selectNodeContents(document.getElementById("pw"));const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand("copy");document.getElementById("copy").textContent="Copied";};</script>
</body></html>`;
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 560, height: 430, resizable: false, title: "Developer account recovered", icon: appIcon(64), autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
    win.on("closed", resolve);
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  });
}

export async function explainNotAdmin() {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    title: "Administrator needed",
    message: "Recovering the Developer account needs a Windows administrator.",
    detail: "Windows will ask for an administrator's approval. Continue?",
    buttons: ["Continue", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
}
