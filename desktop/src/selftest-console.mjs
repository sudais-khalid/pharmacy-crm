/**
 * Self-test of the Developer console's desktop controls, driven through the real app window: sign in,
 * enrol the authenticator, read the status, back up, try a restore with a wrong code, then restore with a
 * fresh code. Runs only on a throwaway data folder with PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD.
 */
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, "")) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export async function consoleScenario({ win, baseUrl, supervisor }) {
  const page = (js) => win.webContents.executeJavaScript(js, true);
  const request = (method, url, body) =>
    page(`fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" }, ${body ? `body: ${JSON.stringify(JSON.stringify(body))}` : ""} })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
  const r = {};

  // a staff page cannot use the controls
  await win.loadURL(`${baseUrl}/login`);
  r.refusedOnStaffPage = (await page("window.pcrmDesktop.status()")).ok === false;

  await win.loadURL(`${baseUrl}/platform/login`);
  r.refusedBeforeSignIn = (await page("window.pcrmDesktop.status()")).ok === false;
  const login = await request("POST", "/api/platform/auth/login", { email: process.env.PLATFORM_OWNER_EMAIL, password: process.env.PLATFORM_OWNER_PASSWORD });
  r.login = login.status;
  const enrolment = await request("GET", "/api/platform/auth/enrol");
  if (!enrolment.body?.secret) return { ...r, loginBody: login.body, enrolment };
  const secret = base32Decode(enrolment.body.secret);
  const step = Math.floor(Date.now() / 30_000);
  r.enrol = (await request("POST", "/api/platform/auth/enrol", { code: totp(secret, step) })).status;

  await win.loadURL(`${baseUrl}/platform/desktop`);
  r.navShowsThisComputer = await page(`new Promise((ok) => setTimeout(() => ok([...document.querySelectorAll("nav a")].some((a) => a.textContent.includes("This computer"))), 800))`);
  const status = await page("window.pcrmDesktop.status()");
  r.status = status.ok;
  r.backup = (await page("window.pcrmDesktop.backupNow()")).ok;
  const latest = (await page("window.pcrmDesktop.status()")).data.backups[0];
  r.latestReason = latest.reason;
  if (process.env.PCRM_SELFTEST_SHOTS) {
    // screenshots for a visual check: the page, then the restore dialog
    win.setSize(1280, 860);
    await win.loadURL(`${baseUrl}/platform/desktop`);
    await new Promise((ok) => setTimeout(ok, 1500));
    writeFileSync(path.join(process.env.PCRM_SELFTEST_SHOTS, "console-desktop.png"), (await win.webContents.capturePage()).toPNG());
    await page(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Restore")?.click()`);
    await new Promise((ok) => setTimeout(ok, 600));
    writeFileSync(path.join(process.env.PCRM_SELFTEST_SHOTS, "console-restore.png"), (await win.webContents.capturePage()).toPNG());
    await page(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  }
  r.wrongCode = (await page(`window.pcrmDesktop.restore(${JSON.stringify(latest.id)}, null, "000000")`)).error;
  r.unknownBackup = (await page(`window.pcrmDesktop.restore("9999", null, "000000")`)).error;
  const restored = await page(`window.pcrmDesktop.restore(${JSON.stringify(latest.id)}, null, ${JSON.stringify(totp(secret, step + 1))})`);
  r.restore = restored.ok ? "ok" : restored.error;
  await new Promise((ok) => setTimeout(ok, 2500)); // the window reloads after a restore
  r.restoredEvent = supervisor.events.includes("restored");
  r.afterRestoreUrl = win.webContents.getURL().replace(baseUrl, "");
  r.audit = await supervisor.db.withClient(supervisor.password, "pharmacy_crm", async (c) =>
    Object.fromEntries((await c.query(`SELECT action, count(*)::int AS n FROM "AuditLog" WHERE action LIKE 'desktop.%' GROUP BY action`)).rows.map((x) => [x.action, x.n])),
  );
  r.preRestoreBackup = supervisor.availableBackups().some((b) => b.reason === "pre-restore");
  return r;
}
