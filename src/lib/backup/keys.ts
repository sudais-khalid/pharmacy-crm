import { createHash, randomBytes } from "node:crypto";
import { base32Decode, base32Encode } from "@/lib/totp";

/**
 * Backup keys: 256 random bits per installation. The recovery key is the same bytes written for people:
 * base32 in groups of four, e.g. "ABCD-EFGH-...". Hyphens, spaces and case do not matter when typed back.
 */
export function newBackupKey(): Buffer {
  return randomBytes(32);
}

export function formatRecoveryKey(key: Buffer): string {
  return base32Encode(key).match(/.{1,4}/g)!.join("-");
}

export function parseRecoveryKey(text: string): Buffer {
  const key = base32Decode(text.replace(/[\s-]/g, ""));
  if (key.length !== 32) throw new Error("That recovery key is not complete. Check every group of characters.");
  return key;
}

/** Short fingerprint stored in backup headers so a wrong key is reported clearly, without revealing the key. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update("pcrm-backup-key:").update(key).digest("hex").slice(0, 16);
}
