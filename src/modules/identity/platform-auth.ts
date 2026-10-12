import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { platformDb } from "@/lib/platform-db";
import { AppError } from "@/lib/errors";
import { seal, open } from "@/lib/secret-box";
import { newTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { isLimited, recordHit, clearBucket } from "@/lib/rate-limit";
import { audit } from "@/modules/platform";

/**
 * The Developer (platform owner) account: bootstrap from server configuration, password and mandatory
 * TOTP sign-in, recovery codes and server-side recovery. There is deliberately no API to create, demote
 * or delete a PlatformUser (docs/plan/02-architecture.md, section 5.4).
 */
const BCRYPT_COST = 12;
const RECOVERY_CODES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8e4PzBzAGOr2lCzPzkXY0bR0wC8o2S";

type Meta = { ip?: string | null; userAgent?: string | null };
const platformCtx = (id: string, meta?: Meta) => ({ actor: { id }, meta, realm: "PLATFORM" as const });

/**
 * Creates the owner account on first start, from PLATFORM_OWNER_EMAIL with PLATFORM_OWNER_PASSWORD (plain,
 * hashed here) or PLATFORM_OWNER_PASSWORD_HASH (bcrypt, for builds that bake it in). Does nothing once any
 * Developer account exists, so the variables cannot be used later to add or replace one.
 */
export async function ensurePlatformOwner(env: Record<string, string | undefined> = process.env): Promise<"created" | "exists" | "not-configured"> {
  if ((await platformDb.platformUser.count()) > 0) return "exists";
  const email = env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
  const plain = env.PLATFORM_OWNER_PASSWORD;
  const hash = env.PLATFORM_OWNER_PASSWORD_HASH;
  if (!email || (!plain && !hash)) return "not-configured";
  if (plain && plain.length < 12) throw new Error("PLATFORM_OWNER_PASSWORD must be at least 12 characters");
  const passwordHash = hash || (await bcrypt.hash(plain!, BCRYPT_COST));
  try {
    const dev = await platformDb.platformUser.create({ data: { name: env.PLATFORM_OWNER_NAME?.trim() || "Developer", email, passwordHash } });
    await audit(platformDb, platformCtx(dev.id), { action: "platform.owner.bootstrap", entity: "PlatformUser", entityId: dev.id, pharmacyId: null });
    return "created";
  } catch (e) {
    // two processes starting at once: the other one created it
    if ((await platformDb.platformUser.count()) > 0) return "exists";
    throw e;
  }
}

/** Step one: email and password. Failures are rate limited per IP and email and per IP. */
export async function platformPasswordLogin(email: string, password: string, meta: Meta = {}) {
  const ip = meta.ip ?? "local";
  const accountBucket = `platform-login:${ip}:${email}`;
  const ipBucket = `platform-login:${ip}`;
  if ((await isLimited(accountBucket, 5, WINDOW_MS)) || (await isLimited(ipBucket, 20, WINDOW_MS))) {
    throw new AppError(429, "Too many sign-in attempts. Try again in a few minutes.");
  }
  await ensurePlatformOwner();
  const dev = await platformDb.platformUser.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, dev?.passwordHash ?? DUMMY_HASH);
  if (!dev || !ok) {
    await recordHit(accountBucket);
    await recordHit(ipBucket);
    throw new AppError(401, "Incorrect email or password.");
  }
  await clearBucket(accountBucket);
  return { id: dev.id, sessionVersion: dev.sessionVersion, totpEnabled: !!dev.totpEnabledAt };
}

/** Starts (or resumes) TOTP enrolment: returns the secret as text, link and QR code. */
export async function startTotpEnrolment(devId: string) {
  const dev = await platformDb.platformUser.findUniqueOrThrow({ where: { id: devId } });
  if (dev.totpEnabledAt) throw new AppError(409, "Two-factor sign-in is already set up.");
  let secret = dev.totpSecret ? open(dev.totpSecret) : null;
  if (!secret) {
    secret = newTotpSecret();
    await platformDb.platformUser.update({ where: { id: devId }, data: { totpSecret: seal(secret) } });
  }
  const uri = otpauthUri(secret, dev.email);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 204 });
  return { secret: secret.replace(/(.{4})/g, "$1 ").trim(), uri, qrSvg };
}

const hashCode = (code: string) => createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

function newRecoveryCodes(): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: RECOVERY_CODES }, () => {
    const raw = Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Finishes enrolment with a first code; returns the recovery codes, shown once. */
export async function confirmTotpEnrolment(devId: string, code: string, meta: Meta = {}) {
  const dev = await platformDb.platformUser.findUniqueOrThrow({ where: { id: devId } });
  if (dev.totpEnabledAt) throw new AppError(409, "Two-factor sign-in is already set up.");
  if (!dev.totpSecret) throw new AppError(409, "Start the set-up first.");
  const step = verifyTotp(open(dev.totpSecret), code);
  if (step === null) throw new AppError(400, "That code is not valid. Check the time on your phone and try again.");
  const codes = newRecoveryCodes();
  await platformDb.platformUser.update({
    where: { id: devId },
    data: { totpEnabledAt: new Date(), totpLastStep: BigInt(step), recoveryCodes: codes.map(hashCode), lastLoginAt: new Date() },
  });
  await audit(platformDb, platformCtx(devId, meta), { action: "platform.mfa.enrol", entity: "PlatformUser", entityId: devId, pharmacyId: null });
  return { recoveryCodes: codes, sessionVersion: dev.sessionVersion };
}

/** Step two: a TOTP code (each one usable once) or a recovery code (consumed). */
export async function verifySecondFactor(devId: string, input: { code?: string; recoveryCode?: string }, meta: Meta = {}) {
  const bucket = `platform-mfa:${devId}`;
  if (await isLimited(bucket, 6, WINDOW_MS)) throw new AppError(429, "Too many attempts. Try again in a few minutes.");
  const dev = await platformDb.platformUser.findUniqueOrThrow({ where: { id: devId } });
  if (!dev.totpEnabledAt || !dev.totpSecret) throw new AppError(409, "Two-factor sign-in is not set up yet.");

  if (input.code) {
    const step = verifyTotp(open(dev.totpSecret), input.code, { notAfterStep: dev.totpLastStep === null ? null : Number(dev.totpLastStep) });
    if (step !== null) {
      await platformDb.platformUser.update({ where: { id: devId }, data: { totpLastStep: BigInt(step), lastLoginAt: new Date() } });
      await clearBucket(bucket);
      await audit(platformDb, platformCtx(devId, meta), { action: "platform.login", entity: "PlatformUser", entityId: devId, pharmacyId: null });
      return { method: "totp" as const, sessionVersion: dev.sessionVersion };
    }
  } else if (input.recoveryCode) {
    const h = hashCode(input.recoveryCode);
    if (dev.recoveryCodes.includes(h)) {
      const left = dev.recoveryCodes.filter((c) => c !== h);
      await platformDb.platformUser.update({ where: { id: devId }, data: { recoveryCodes: left, lastLoginAt: new Date() } });
      await clearBucket(bucket);
      await audit(platformDb, platformCtx(devId, meta), { action: "platform.login.recovery", entity: "PlatformUser", entityId: devId, after: { recoveryCodesLeft: left.length }, pharmacyId: null });
      return { method: "recovery" as const, recoveryCodesLeft: left.length, sessionVersion: dev.sessionVersion };
    }
  }
  await recordHit(bucket);
  throw new AppError(401, "That code is not valid.");
}

/**
 * Server-side recovery (npm run platform:recover-owner): sets a new password, removes two-factor sign-in
 * so it is set up again, and ends every session. Needs shell access to the server; no API calls this.
 */
export async function recoverPlatformOwner(email: string, newPassword?: string) {
  const password = newPassword ?? randomBytes(15).toString("base64url");
  if (password.length < 12) throw new Error("The new password must be at least 12 characters");
  const dev = await platformDb.platformUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!dev) throw new Error(`No Developer account with email ${email}`);
  await platformDb.platformUser.update({
    where: { id: dev.id },
    data: { passwordHash: await bcrypt.hash(password, BCRYPT_COST), totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [], sessionVersion: { increment: 1 } },
  });
  await audit(platformDb, platformCtx(dev.id), { action: "platform.owner.recover", entity: "PlatformUser", entityId: dev.id, pharmacyId: null });
  return { email: dev.email, password };
}
