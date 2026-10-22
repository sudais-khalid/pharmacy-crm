/**
 * Creates the Developer's one authenticator for every installation (src/lib/shared-totp.ts). Run it once on
 * the Developer's own computer:
 *
 *   npm run developer:authenticator
 *
 * It reads the Developer password from .env (PLATFORM_OWNER_PASSWORD), checks it against
 * desktop/build/owner.json, makes a new authenticator secret, seals it with the password, and writes:
 *   desktop/build/owner.json                    the sealed secret, packaged into local installer builds
 *   desktop/build/PCRM_OWNER_TOTP.txt           the same sealed value, for the GitHub secret of release builds
 *   desktop/build/developer-authenticator.html  the QR code to scan once, the key as text, and the code
 *                                               that is valid right now; delete it after scanning
 * desktop/build is never committed.
 *
 *   npm run developer:authenticator -- --show
 *
 * shows the existing shared authenticator again (to scan it on a new phone, or when a code is refused),
 * without making a new one: nothing in owner.json or GitHub changes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { newTotpSecret, otpauthUri } from "../src/lib/totp";
import { openSharedTotp, sealSharedTotp } from "../src/lib/shared-totp";
import { developerPasswordProblem } from "../src/lib/password-strength";

const repo = path.resolve(__dirname, "..");
const build = path.join(repo, "desktop", "build");
const ownerFile = path.join(build, "owner.json");

async function main() {
  if (existsSync(path.join(repo, ".env"))) process.loadEnvFile(path.join(repo, ".env"));
  const password = process.env.PCRM_OWNER_PASSWORD || process.env.PLATFORM_OWNER_PASSWORD || "";
  if (!existsSync(ownerFile)) throw new Error("No desktop/build/owner.json yet: run `npm run owner` in desktop/ first.");
  const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
  if (!password) throw new Error("Set PLATFORM_OWNER_PASSWORD in .env: the shared authenticator is sealed with it.");
  if (!bcrypt.compareSync(password, owner.passwordHash)) throw new Error("PLATFORM_OWNER_PASSWORD in .env is not the password of the Developer account in owner.json.");
  const page = path.join(build, "developer-authenticator.html");

  if (process.argv.includes("--show")) {
    if (!owner.totp) throw new Error("There is no shared authenticator yet: run npm run developer:authenticator without --show.");
    const existing = openSharedTotp(owner.totp, password);
    if (!existing) throw new Error("The shared authenticator in owner.json does not open with PLATFORM_OWNER_PASSWORD.");
    writeFileSync(page, await scanPage(existing, owner.email));
    console.log(`Open ${path.relative(repo, page)} in your browser, scan the QR code, and check that your phone shows the
same code as the page. Then delete the file. Nothing else changed.`);
    return;
  }
  // the shared secret is only as safe as this password: refuse a weak one
  const problem = developerPasswordProblem(password, owner.email);
  if (problem) throw new Error(`The Developer password is too weak to seal the shared authenticator (${problem}). Run npm run developer:password first.`);

  const secret = newTotpSecret();
  const sealed = sealSharedTotp(secret, password);
  if (openSharedTotp(sealed, password) !== secret) throw new Error("The sealed value did not open again; nothing was written.");

  writeFileSync(ownerFile, JSON.stringify({ ...owner, totp: sealed }, null, 2) + "\n");
  writeFileSync(path.join(build, "PCRM_OWNER_TOTP.txt"), sealed + "\n");
  writeFileSync(page, await scanPage(secret, owner.email));
  const qr = page;

  console.log(`Shared authenticator created for ${owner.email}.

1. Scan the QR code once with your authenticator app:
     ${path.relative(repo, qr)}
   Then delete that file.
2. For installers built on GitHub, add a repository secret named PCRM_OWNER_TOTP whose value is the
   content of ${path.relative(repo, path.join(build, "PCRM_OWNER_TOTP.txt"))}.
3. Every installation built from now on accepts that one authenticator entry: sign in with your
   Developer password and the code. Existing installations take it over when they update.

Keep the Developer password long and used nowhere else: the shared secret is sealed with it.`);
}

/**
 * A page to scan from: the QR code, the key as text for typing in, and the code that is valid now (worked
 * out in the page itself, so the phone can be checked against it before anything is relied on).
 */
async function scanPage(secret: string, email: string) {
  const svg = await QRCode.toString(otpauthUri(secret, `${email} (all installations)`), { type: "svg", margin: 2, width: 300 });
  const groups = secret.match(/.{1,4}/g)!.join(" ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pharmacy CRM Developer authenticator</title>
<style>body{font-family:"Segoe UI",system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#12312f}
h1{font-size:20px}p,li{font-size:15px;line-height:1.5}.qr{width:300px;height:300px;margin:12px 0}.qr svg{width:100%;height:100%}
.key{font:600 18px Consolas,monospace;letter-spacing:1px;background:#eef5f4;padding:10px 12px;border-radius:6px}
.code{font:700 40px Consolas,monospace;letter-spacing:6px;color:#1f7f78}.warn{color:#b42318}</style></head><body>
<h1>Pharmacy CRM: Developer authenticator (all installations)</h1>
<ol><li>In your authenticator app, delete the old Pharmacy CRM entries.</li>
<li>Scan this code (or add it by hand with the key below, type: time based).</li></ol>
<div class="qr">${svg}</div>
<p>Key: <span class="key">${groups}</span></p>
<p>Your phone must now show this code (it changes every 30 seconds):</p>
<div class="code" id="code">------</div><p id="left"></p>
<p class="warn">If the codes differ, turn on automatic date and time on the phone. Delete this file when done: it holds the secret.</p>
<script>
const SECRET = ${JSON.stringify(secret)};
function b32(s){const A="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits=0,val=0;const out=[];for(const ch of s){val=(val<<5)|A.indexOf(ch);bits+=5;if(bits>=8){out.push((val>>>(bits-8))&255);bits-=8;}}return new Uint8Array(out);}
async function code(){const step=Math.floor(Date.now()/30000);const msg=new ArrayBuffer(8);new DataView(msg).setUint32(4,step);
const key=await crypto.subtle.importKey("raw",b32(SECRET),{name:"HMAC",hash:"SHA-1"},false,["sign"]);
const h=new Uint8Array(await crypto.subtle.sign("HMAC",key,msg));const o=h[19]&15;
const n=(((h[o]&127)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3])%1000000;
document.getElementById("code").textContent=String(n).padStart(6,"0");
document.getElementById("left").textContent=(30-Math.floor(Date.now()/1000)%30)+" seconds left";}
code();setInterval(code,1000);
</script></body></html>`;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
