import { createHash, randomBytes } from "node:crypto";

/** One-time recovery codes for authenticator sign-in (Developer and staff). Only their hashes are stored. */
export const RECOVERY_CODES = 10;

export const hashRecoveryCode = (code: string) => createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

export function newRecoveryCodes(): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: RECOVERY_CODES }, () => {
    const raw = Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
