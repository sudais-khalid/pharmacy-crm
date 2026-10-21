import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { base32Decode, codeAt, newTotpSecret, timeStep } from "@/lib/totp";
import { openSharedTotp, sealSharedTotp } from "@/lib/shared-totp";
import { confirmTotpEnrolment, ensurePlatformOwner, platformPasswordLogin, recoverPlatformOwner, startTotpEnrolment, verifySecondFactor } from "@/modules/identity";
import { open } from "@/lib/secret-box";
import { resetDb } from "./helpers";

const EMAIL = "dev@shared.example";
const PASSWORD = "One-Long-Developer-Password-2026";
const saved = { email: process.env.PLATFORM_OWNER_EMAIL, password: process.env.PLATFORM_OWNER_PASSWORD, totp: process.env.PLATFORM_OWNER_TOTP };

beforeEach(async () => {
  await resetDb();
  process.env.PLATFORM_OWNER_EMAIL = EMAIL;
  process.env.PLATFORM_OWNER_PASSWORD = PASSWORD;
  delete process.env.PLATFORM_OWNER_TOTP;
});
afterEach(() => {
  for (const [k, v] of [["PLATFORM_OWNER_EMAIL", saved.email], ["PLATFORM_OWNER_PASSWORD", saved.password], ["PLATFORM_OWNER_TOTP", saved.totp]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const code = (secret: string, ahead = 0) => codeAt(base32Decode(secret), timeStep() + ahead);

describe("the Developer's one authenticator for every installation", () => {
  it("is sealed with the password: the right password opens it, anything else does not", () => {
    const secret = newTotpSecret();
    const sealed = sealSharedTotp(secret, PASSWORD);
    expect(sealed).not.toContain(secret);
    expect(openSharedTotp(sealed, PASSWORD)).toBe(secret);
    expect(openSharedTotp(sealed, "Another-Password-2026")).toBeNull();
    expect(openSharedTotp(sealed.slice(0, -4) + "AAAA", PASSWORD)).toBeNull();
    expect(openSharedTotp("not a sealed value", PASSWORD)).toBeNull();
  });

  it("works on a fresh installation with nothing to scan", async () => {
    const secret = newTotpSecret();
    process.env.PLATFORM_OWNER_TOTP = sealSharedTotp(secret, PASSWORD);
    await ensurePlatformOwner();
    const login = await platformPasswordLogin(EMAIL, PASSWORD);
    expect(login.totpEnabled).toBe(true); // straight to the code, no set-up screen
    await expect(verifySecondFactor(login.id, { code: code(secret) })).resolves.toMatchObject({ method: "totp" });
    expect(await platformDb.auditLog.count({ where: { action: "platform.mfa.shared" } })).toBe(1);
  });

  it("replaces an installation's own authenticator and keeps its recovery codes", async () => {
    await ensurePlatformOwner();
    const dev = await platformDb.platformUser.findUniqueOrThrow({ where: { email: EMAIL } });
    await startTotpEnrolment(dev.id);
    const own = open((await platformDb.platformUser.findUniqueOrThrow({ where: { id: dev.id } })).totpSecret!);
    const { recoveryCodes } = await confirmTotpEnrolment(dev.id, code(own));

    const shared = newTotpSecret();
    process.env.PLATFORM_OWNER_TOTP = sealSharedTotp(shared, PASSWORD);
    await platformPasswordLogin(EMAIL, PASSWORD);
    await expect(verifySecondFactor(dev.id, { code: code(own, 1) })).rejects.toThrow(/not valid/);
    await expect(verifySecondFactor(dev.id, { code: code(shared, 1) })).resolves.toMatchObject({ method: "totp" });
    await expect(verifySecondFactor(dev.id, { recoveryCode: recoveryCodes[0] })).resolves.toMatchObject({ method: "recovery" });
  });

  it("is not used after the password was changed by recovery: the installation keeps its own set-up", async () => {
    const shared = newTotpSecret();
    process.env.PLATFORM_OWNER_TOTP = sealSharedTotp(shared, PASSWORD);
    await ensurePlatformOwner();
    const { password } = await recoverPlatformOwner(EMAIL, "A-Brand-New-Password-2026");
    const login = await platformPasswordLogin(EMAIL, password);
    expect(login.totpEnabled).toBe(false); // asks to set up two-factor here instead
  });
});
