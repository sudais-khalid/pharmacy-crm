// Writes desktop/build/owner.json: the Developer account that a new installation creates on its first start
// (architecture, section 2.3). It holds the email and a bcrypt hash, never the password itself, and is
// packaged with the app but never committed (desktop/build is ignored by git).
//
// Sources, first found wins:
//   PCRM_OWNER_EMAIL with PCRM_OWNER_PASSWORD_HASH or PCRM_OWNER_PASSWORD (release builds, from CI secrets)
//   PLATFORM_OWNER_EMAIL with PLATFORM_OWNER_PASSWORD from the repository's .env (local builds)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const require = createRequire(path.join(repo, "package.json"));
const bcrypt = require("bcryptjs");

if (existsSync(path.join(repo, ".env"))) process.loadEnvFile(path.join(repo, ".env"));
const env = process.env;
const email = (env.PCRM_OWNER_EMAIL || env.PLATFORM_OWNER_EMAIL || "").trim().toLowerCase();
const name = (env.PCRM_OWNER_NAME || env.PLATFORM_OWNER_NAME || "Developer").trim();
const plain = env.PCRM_OWNER_PASSWORD || env.PLATFORM_OWNER_PASSWORD || "";
let hash = env.PCRM_OWNER_PASSWORD_HASH || "";

if (!email || (!hash && !plain)) {
  console.error("Set PCRM_OWNER_EMAIL and PCRM_OWNER_PASSWORD (or PCRM_OWNER_PASSWORD_HASH), or PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD in .env.");
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`"${email}" is not an email address.`);
  process.exit(1);
}
if (!hash) {
  if (plain.length < 12) {
    console.error("The owner password must be at least 12 characters.");
    process.exit(1);
  }
  hash = bcrypt.hashSync(plain, 12);
}
if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(hash)) {
  console.error("PCRM_OWNER_PASSWORD_HASH is not a bcrypt hash.");
  process.exit(1);
}

const out = path.join(here, "..", "build", "owner.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ email, name, passwordHash: hash }, null, 2) + "\n");
console.log(`wrote ${path.relative(repo, out)} for ${email}`);
