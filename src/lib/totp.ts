import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s steps), compatible with Google
 * Authenticator, Microsoft Authenticator, Authy and others. Implemented here to avoid a dependency for
 * a few lines of well-specified code; covered by the RFC test vectors.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), base32 encoded for authenticator apps. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function timeStep(at = Date.now()): number {
  return Math.floor(at / 1000 / STEP_SECONDS);
}

/** The code for one time step (HOTP, RFC 4226). `digits` other than 6 exist only for the RFC test vectors. */
export function codeAt(secret: Buffer, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the matched
 * step so callers can refuse it next time (replay protection), or null.
 */
export function verifyTotp(secretBase32: string, code: string, opts: { at?: number; window?: number; notAfterStep?: number | null } = {}): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretBase32);
  const now = timeStep(opts.at);
  const window = opts.window ?? 1;
  for (let s = now - window; s <= now + window; s++) {
    if (opts.notAfterStep != null && s <= opts.notAfterStep) continue;
    const expected = Buffer.from(codeAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(clean))) return s;
  }
  return null;
}

/** otpauth:// link the authenticator app imports (shown as a QR code). */
export function otpauthUri(secretBase32: string, account: string, issuer = "Pharmacy CRM"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
