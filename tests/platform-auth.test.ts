import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { platformDb } from "@/lib/platform-db";
import { base32Decode, base32Encode, codeAt, timeStep, verifyTotp } from "@/lib/totp";
import { seal, open } from "@/lib/secret-box";
import {
  ensurePlatformOwner, platformPasswordLogin, startTotpEnrolment, confirmTotpEnrolment, verifySecondFactor, recoverPlatformOwner,
} from "@/modules/identity";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const RFC_SECRET = Buffer.from("12345678901234567890");
const OWNER = { PLATFORM_OWNER_EMAIL: "Owner@Example.com", PLATFORM_OWNER_PASSWORD: "Correct-Horse-42" };

async function owner() {
  await ensurePlatformOwner(OWNER);
  return platformDb.platformUser.findUniqueOrThrow({ where: { email: "owner@example.com" } });
}
const currentCode = async (devId: string, offsetSteps = 0) => {
  const dev = await platformDb.platformUser.findUniqueOrThrow({ where: { id: devId } });
  return codeAt(base32Decode(open(dev.totpSecret!)), timeStep() + offsetSteps);
};

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vectors (SHA-1)", () => {
    for (const [t, code] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"]] as const) {
      expect(codeAt(RFC_SECRET, Math.floor(t / 30), 8)).toBe(code);
    }
  });

  it("round-trips base32 and accepts one step of drift but not replays", () => {
    const secret = base32Encode(RFC_SECRET);
    expect(base32Decode(secret).equals(RFC_SECRET)).toBe(true);
    const at = 1_700_000_000_000;
    const step = timeStep(at);
    const code = codeAt(RFC_SECRET, step);
    expect(verifyTotp(secret, code, { at })).toBe(step);
    expect(verifyTotp(secret, codeAt(RFC_SECRET, step - 1), { at })).toBe(step - 1);
    expect(verifyTotp(secret, codeAt(RFC_SECRET, step - 3), { at })).toBeNull();
    expect(verifyTotp(secret, code, { at, notAfterStep: step })).toBeNull();
    expect(verifyTotp(secret, "12345", { at })).toBeNull();
  });
});

describe("secret box", () => {
  it("encrypts with authentication", () => {
    const sealed = seal("JBSWY3DPEHPK3PXP");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(open(sealed)).toBe("JBSWY3DPEHPK3PXP");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => open(parts.join("."))).toThrow();
  });
});

describe("Developer account", () => {
  it("is created from configuration only while none exists", async () => {
    expect(await ensurePlatformOwner({})).toBe("not-configured");
    expect(await ensurePlatformOwner(OWNER)).toBe("created");
    expect(await ensurePlatformOwner({ PLATFORM_OWNER_EMAIL: "intruder@example.com", PLATFORM_OWNER_PASSWORD: "Another-Password-1" })).toBe("exists");
    const all = await platformDb.platformUser.findMany();
    expect(all.map((d) => d.email)).toEqual(["owner@example.com"]);
    expect(await bcrypt.compare("Correct-Horse-42", all[0].passwordHash)).toBe(true);
    await expect(ensurePlatformOwner({ PLATFORM_OWNER_EMAIL: "x@y.z", PLATFORM_OWNER_PASSWORD: "short" })).resolves.toBe("exists");
  });

  it("accepts a pre-hashed password for builds that bake it in", async () => {
    const hash = await bcrypt.hash("Baked-Password-99", 4);
    expect(await ensurePlatformOwner({ PLATFORM_OWNER_EMAIL: "owner@example.com", PLATFORM_OWNER_PASSWORD_HASH: hash })).toBe("created");
    await expect(platformPasswordLogin("owner@example.com", "Baked-Password-99")).resolves.toMatchObject({ totpEnabled: false });
  });

  it("rate limits wrong passwords", async () => {
    await owner();
    for (let i = 0; i < 5; i++) await expect(platformPasswordLogin("owner@example.com", "wrong", { ip: "9.9.9.9" })).rejects.toThrow(/Incorrect/);
    await expect(platformPasswordLogin("owner@example.com", "Correct-Horse-42", { ip: "9.9.9.9" })).rejects.toThrow(/Too many/);
    await expect(platformPasswordLogin("owner@example.com", "Correct-Horse-42", { ip: "1.1.1.1" })).resolves.toMatchObject({ totpEnabled: false });
  });

  it("enrols TOTP, refuses replayed codes and consumes recovery codes", async () => {
    const dev = await owner();
    const first = await startTotpEnrolment(dev.id);
    const again = await startTotpEnrolment(dev.id);
    expect(again.secret).toBe(first.secret); // resuming keeps the scanned secret
    expect(first.qrSvg).toContain("<svg");
    await expect(confirmTotpEnrolment(dev.id, "000000")).rejects.toThrow(/not valid/);
    const { recoveryCodes } = await confirmTotpEnrolment(dev.id, await currentCode(dev.id));
    expect(recoveryCodes).toHaveLength(10);
    await expect(startTotpEnrolment(dev.id)).rejects.toThrow(/already/);

    // a fresh code from the next step works once, then is refused
    const next = await currentCode(dev.id, 1);
    await expect(verifySecondFactor(dev.id, { code: next })).resolves.toMatchObject({ method: "totp" });
    await expect(verifySecondFactor(dev.id, { code: next })).rejects.toThrow(/not valid/);

    await expect(verifySecondFactor(dev.id, { recoveryCode: recoveryCodes[0].toLowerCase() })).resolves.toMatchObject({ method: "recovery", recoveryCodesLeft: 9 });
    await expect(verifySecondFactor(dev.id, { recoveryCode: recoveryCodes[0] })).rejects.toThrow(/not valid/);
    const stored = await platformDb.platformUser.findUniqueOrThrow({ where: { id: dev.id } });
    expect(JSON.stringify(stored.recoveryCodes)).not.toContain(recoveryCodes[1]); // only hashes are stored
  });

  it("restored on a computer with another two-factor key: explains the way out, and recovery codes still work", async () => {
    const dev = await owner();
    await startTotpEnrolment(dev.id);
    const { recoveryCodes } = await confirmTotpEnrolment(dev.id, await currentCode(dev.id));
    const code = await currentCode(dev.id, 1);
    // the same data, now on a computer whose key the backup did not carry
    const before = process.env.TOTP_ENCRYPTION_KEY;
    process.env.TOTP_ENCRYPTION_KEY = "another-computer-two-factor-key-0123456789abcdef";
    try {
      await expect(verifySecondFactor(dev.id, { code })).rejects.toThrow(/set up on another computer.*recovery codes/);
      await expect(verifySecondFactor(dev.id, { recoveryCode: recoveryCodes[0] })).resolves.toMatchObject({ method: "recovery" });
    } finally {
      if (before === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
      else process.env.TOTP_ENCRYPTION_KEY = before;
    }
  });

  it("is recovered from the server: new password, 2FA removed, sessions ended", async () => {
    const dev = await owner();
    await startTotpEnrolment(dev.id);
    await confirmTotpEnrolment(dev.id, await currentCode(dev.id));
    const r = await recoverPlatformOwner("owner@example.com");
    expect(r.password.length).toBeGreaterThanOrEqual(12);
    const after = await platformDb.platformUser.findUniqueOrThrow({ where: { id: dev.id } });
    expect(after).toMatchObject({ totpSecret: null, totpEnabledAt: null, recoveryCodes: [], sessionVersion: dev.sessionVersion + 1 });
    await expect(platformPasswordLogin("owner@example.com", r.password)).resolves.toMatchObject({ totpEnabled: false });
    const actions = (await platformDb.auditLog.findMany({ where: { realm: "PLATFORM" }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["platform.owner.bootstrap", "platform.mfa.enrol", "platform.owner.recover"]);
  });
});
