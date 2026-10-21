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
 *   desktop/build/developer-authenticator.svg   the QR code to scan once; delete it after scanning
 * desktop/build is never committed.
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
  // the shared secret is only as safe as this password: refuse a weak one
  const problem = developerPasswordProblem(password, owner.email);
  if (problem) throw new Error(`The Developer password is too weak to seal the shared authenticator (${problem}). Run npm run developer:password first.`);

  const secret = newTotpSecret();
  const sealed = sealSharedTotp(secret, password);
  if (openSharedTotp(sealed, password) !== secret) throw new Error("The sealed value did not open again; nothing was written.");

  writeFileSync(ownerFile, JSON.stringify({ ...owner, totp: sealed }, null, 2) + "\n");
  writeFileSync(path.join(build, "PCRM_OWNER_TOTP.txt"), sealed + "\n");
  const qr = path.join(build, "developer-authenticator.svg");
  writeFileSync(qr, await QRCode.toString(otpauthUri(secret, `${owner.email} (all installations)`), { type: "svg", margin: 2, width: 320 }));

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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
