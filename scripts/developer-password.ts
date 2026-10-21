/**
 * Changes the Developer password for every installation, keeping the same shared authenticator:
 *
 *   npm run developer:password
 *
 * It checks the current password (PLATFORM_OWNER_PASSWORD in .env) against desktop/build/owner.json, then
 * uses PCRM_NEW_OWNER_PASSWORD when set and strong enough, or makes a strong one. To keep a password typed
 * into PLATFORM_OWNER_PASSWORD by hand, put the previous one in PCRM_CURRENT_OWNER_PASSWORD for one run;
 * that line is removed from .env afterwards. It writes:
 *   .env                                        PLATFORM_OWNER_PASSWORD becomes the new password
 *   desktop/build/owner.json                    the new hash, when it was set, and the shared authenticator
 *                                               sealed again with the new password (nothing to scan)
 *   desktop/build/PCRM_OWNER_PASSWORD_HASH.txt  the value for the GitHub secret of the same name
 *   desktop/build/PCRM_OWNER_TOTP.txt           the value for the GitHub secret of the same name
 * Installations take the new password with their next update; their older sessions end. The password itself
 * is never printed.
 */
import { randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { developerPasswordProblem } from "../src/lib/password-strength";
import { openSharedTotp, sealSharedTotp } from "../src/lib/shared-totp";

const repo = path.resolve(__dirname, "..");
const envFile = path.join(repo, ".env");
const build = path.join(repo, "desktop", "build");
const ownerFile = path.join(build, "owner.json");

/** Six groups of four letters and digits (no look-alikes such as 0 and O), about 140 bits. */
function strongPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  for (;;) {
    const groups = Array.from({ length: 6 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(""));
    const candidate = groups.join("-");
    if (!developerPasswordProblem(candidate)) return candidate;
  }
}

async function main() {
  if (!existsSync(envFile)) throw new Error("No .env file in the repository.");
  process.loadEnvFile(envFile);
  if (!existsSync(ownerFile)) throw new Error("No desktop/build/owner.json yet: run `npm run owner` in desktop/ first.");
  const owner = JSON.parse(readFileSync(ownerFile, "utf8"));
  // the previous password may be given separately when the new one was already typed into .env
  const previousGiven = process.env.PCRM_CURRENT_OWNER_PASSWORD;
  const current = previousGiven ?? process.env.PLATFORM_OWNER_PASSWORD ?? "";
  if (!current || !bcrypt.compareSync(current, owner.passwordHash)) {
    throw new Error(previousGiven
      ? "PCRM_CURRENT_OWNER_PASSWORD is not the current Developer password in owner.json."
      : "PLATFORM_OWNER_PASSWORD in .env is not the current Developer password in owner.json. If you typed a new one there, add the previous one as PCRM_CURRENT_OWNER_PASSWORD and run this again.");
  }

  const chosen = process.env.PCRM_NEW_OWNER_PASSWORD ?? (previousGiven ? process.env.PLATFORM_OWNER_PASSWORD : undefined);
  const next = chosen || strongPassword();
  const problem = developerPasswordProblem(next, owner.email);
  if (problem) throw new Error(`The new Developer password is too weak: ${problem}. Nothing was changed.`);
  if (next === current) throw new Error("The new password is the same as the current one.");

  let totp: string | undefined;
  if (owner.totp) {
    const secret = openSharedTotp(owner.totp, current);
    if (!secret) throw new Error("The shared authenticator in owner.json does not open with the current password; run npm run developer:authenticator after this.");
    totp = sealSharedTotp(secret, next);
  }
  const passwordHash = bcrypt.hashSync(next, 12);
  const passwordSetAt = new Date().toISOString();

  writeFileSync(ownerFile, JSON.stringify({ ...owner, passwordHash, passwordSetAt, ...(totp ? { totp } : {}) }, null, 2) + "\n");
  writeFileSync(path.join(build, "PCRM_OWNER_PASSWORD_HASH.txt"), `${passwordHash}|${passwordSetAt}\n`);
  if (totp) writeFileSync(path.join(build, "PCRM_OWNER_TOTP.txt"), totp + "\n");
  // the new password goes where the old one was; quotes stop the shell or dotenv reading # or $ in it
  // and the one-run helper lines leave the file
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => !/^\s*PCRM_(CURRENT|NEW)_OWNER_PASSWORD\s*=/.test(l));
  const at = lines.findIndex((l) => /^\s*PLATFORM_OWNER_PASSWORD\s*=/.test(l));
  const line = `PLATFORM_OWNER_PASSWORD="${next}"`;
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  writeFileSync(envFile, lines.join("\n"));

  console.log(`The Developer password of ${owner.email} is changed${chosen ? "" : " to a new strong one"}.

- The new password is in .env as PLATFORM_OWNER_PASSWORD. Save it in your password manager.
- Update two GitHub repository secrets:
    PCRM_OWNER_PASSWORD_HASH  with the content of desktop/build/PCRM_OWNER_PASSWORD_HASH.txt${totp ? "\n    PCRM_OWNER_TOTP           with the content of desktop/build/PCRM_OWNER_TOTP.txt" : ""}
- Every installation switches to the new password with its next update, and signs out older sessions.${totp ? "\n- Your authenticator entry stays the same: nothing to scan." : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
