import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Authenticated encryption (AES-256-GCM) for small secrets stored in the database, such as TOTP seeds.
 * The key comes from TOTP_ENCRYPTION_KEY; without it a key is derived from JWT_SECRET (acceptable for
 * development, a separate key is recommended in production so one leaked secret does not expose both).
 * Format: v1.<iv>.<tag>.<ciphertext>, base64url.
 */
function key(): Buffer {
  const material = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!material || material.length < 32) throw new Error("TOTP_ENCRYPTION_KEY (or JWT_SECRET) must be at least 32 characters");
  return createHash("sha256").update(`secret-box:v1:${material}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function open(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Like open, but null when the secret was sealed with another key: data restored from a computer whose
 * key the backup did not carry. Callers explain how to set two-factor sign-in up again.
 */
export function openOrNull(sealed: string): string | null {
  try {
    return open(sealed);
  } catch {
    return null;
  }
}
