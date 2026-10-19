/**
 * Start-up splash with a progress line, and the tray icon image. Both are generated here so the app
 * needs no image files at run time.
 */
import { BrowserWindow, nativeImage } from "electron";

const TEAL = { r: 0x1f, g: 0x7f, b: 0x78 };

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

/** A teal rounded square with a white cross, drawn pixel by pixel (BGRA). */
export function appIcon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = size * 0.2;
  const arm = size * 0.14;
  const reach = size * 0.3;
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x - c) - (c - radius));
      const dy = Math.max(0, Math.abs(y - c) - (c - radius));
      const inside = dx * dx + dy * dy <= radius * radius;
      const cross = (Math.abs(x - c) <= arm && Math.abs(y - c) <= reach) || (Math.abs(y - c) <= arm && Math.abs(x - c) <= reach);
      const i = (y * size + x) * 4;
      if (!inside) continue;
      const [r, g, b] = cross ? [255, 255, 255] : [TEAL.r, TEAL.g, TEAL.b];
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
