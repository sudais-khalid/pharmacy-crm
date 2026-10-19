/**
 * Start-up splash with a progress line, and the tray icon image. Both are generated here so the app
 * needs no image files at run time.
 */
import { BrowserWindow, nativeImage } from "electron";
import { TEAL, iconPixels } from "./icon-pixels.mjs";

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Pharmacy CRM</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html,body{margin:0;height:100%;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;background:#fff;color:#12312f}
  *{box-sizing:border-box}
  body{display:flex;flex-direction:column;justify-content:center;padding:0 32px;border-top:6px solid rgb(${TEAL.r},${TEAL.g},${TEAL.b})}
  h1{font-size:20px;margin:0 0 6px}
  #status{font-size:13px;color:#4a6563;min-height:18px}
  .bar{margin-top:18px;height:4px;background:#e3efee;border-radius:2px;overflow:hidden}
  .bar i{display:block;height:100%;width:30%;background:rgb(${TEAL.r},${TEAL.g},${TEAL.b});animation:m 1.2s ease-in-out infinite}
  @keyframes m{0%{margin-left:-30%}100%{margin-left:100%}}
</style></head><body>
<h1>Pharmacy CRM</h1><div id="status">Starting</div><div class="bar"><i></i></div>
<script>window.setStatus = (t) => { document.getElementById("status").textContent = t; };</script>
</body></html>`;

export async function showSplash({ show = true } = {}) {
  const win = new BrowserWindow({
    width: 440,
    height: 200,
    frame: false,
    resizable: false,
    show: false,
    center: true,
    skipTaskbar: false,
    title: "Pharmacy CRM",
    icon: appIcon(64),
    webPreferences: { contextIsolation: true, sandbox: true, javascript: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  if (show) win.show();
  return {
    status(text) {
      if (!win.isDestroyed()) win.webContents.executeJavaScript(`setStatus(${JSON.stringify(text)})`).catch(() => {});
    },
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

/** The app icon at the given size (see icon-pixels.mjs); Electron bitmaps are BGRA. */
export function appIcon(size = 32) {
  const rgba = iconPixels(size);
  for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
  return nativeImage.createFromBitmap(rgba, { width: size, height: size });
}
