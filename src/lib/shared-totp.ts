import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * One Developer authenticator for every installation. The Developer scans one secret once; each installer
 * carries it sealed with a key derived from the Developer password (scrypt, deliberately slow), and an
 * installation opens it when the Developer signs in with that password. The installer alone reveals
 * nothing usable; the password is what keeps it safe, so it must be long and used nowhere else.
 *
 * Format: v1.<salt>.<iv>.<tag>.<ciphertext>, base64url, AES-256-GCM.
 */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

const keyFrom = (password: string, salt: Buffer) => scryptSync(password.normalize("NFKC"), Buffer.concat([Buffer.from("pcrm-shared-totp:v1:"), salt]), 32, SCRYPT);

export function sealSharedTotp(secretBase32: string, password: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(password, salt), iv);
  const data = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  return ["v1", salt, iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** The secret, or null for a different password (changed since, for example) or a damaged value. */
export function openSharedTotp(sealed: string, password: string): string | null {
  const [version, salt, iv, tag, data] = sealed.trim().split(".");
  if (version !== "v1" || !salt || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(password, Buffer.from(salt, "base64url")), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
