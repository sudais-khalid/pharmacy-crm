import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import { platformDb } from "@/lib/platform-db";
import { developerPasswordProblem } from "@/lib/password-strength";
import { ensurePlatformOwner, recoverPlatformOwner } from "@/modules/identity";
import { resetDb } from "./helpers";

beforeEach(resetDb);

const EMAIL = "dev@rotate.example";
const build = (password: string, setAt: string) => ({ PLATFORM_OWNER_EMAIL: EMAIL, PLATFORM_OWNER_PASSWORD_HASH: bcrypt.hashSync(password, 4), PLATFORM_OWNER_PASSWORD_SET_AT: setAt });
const account = () => platformDb.platformUser.findUniqueOrThrow({ where: { email: EMAIL } });

describe("Developer password strength", () => {
  it("refuses short, plain and common passwords, and accepts long mixed ones", () => {
    expect(developerPasswordProblem("Pharmacy@2026")).toMatch(/16 characters/);
    expect(developerPasswordProblem("alllowercaseletters")).toMatch(/three/);
    expect(developerPasswordProblem("MyPharmacyPassword#2026")).toMatch(/common word/);
    expect(developerPasswordProblem("Xq7-mudasir-Kp92-zz", "mudasir@example.com")).toMatch(/email name/);
    expect(developerPasswordProblem("Kp7d-xQ2m-R9tv-hW4z-B3nc-Y8jf")).toBeNull();
    expect(developerPasswordProblem("correct horse battery staple river")).toBeNull(); // a long passphrase
  });
});

describe("a new Developer password reaches every installation with its update", () => {
  it("replaces an older password, ends older sessions, and ignores builds that are not newer", async () => {
    await ensurePlatformOwner(build("Old-Password-Kp7d-xQ2m", "2026-10-01T00:00:00.000Z"));
    const before = await account();
    expect(await ensurePlatformOwner(build("New-Password-R9tv-hW4z", "2026-10-21T00:00:00.000Z"))).toBe("updated");
    const after = await account();
    expect(bcrypt.compareSync("New-Password-R9tv-hW4z", after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await platformDb.auditLog.count({ where: { action: "platform.owner.password-from-build" } })).toBe(1);

    // an older build (installed again, for example) changes nothing
    expect(await ensurePlatformOwner(build("Old-Password-Kp7d-xQ2m", "2026-10-01T00:00:00.000Z"))).toBe("exists");
    expect(bcrypt.compareSync("New-Password-R9tv-hW4z", (await account()).passwordHash)).toBe(true);
  });

  it("keeps a password set by recovery until a newer build arrives", async () => {
    await ensurePlatformOwner(build("Old-Password-Kp7d-xQ2m", "2026-10-01T00:00:00.000Z"));
    const { password } = await recoverPlatformOwner(EMAIL, "Recovered-Password-B3nc-Y8jf");
    // the same build again: recovery is newer, so it stays
    expect(await ensurePlatformOwner(build("Old-Password-Kp7d-xQ2m", "2026-10-01T00:00:00.000Z"))).toBe("exists");
    expect(bcrypt.compareSync(password, (await account()).passwordHash)).toBe(true);
    // a build made after the recovery wins
    expect(await ensurePlatformOwner(build("Newest-Password-Mz4q-Tp8w", new Date(Date.now() + 60_000).toISOString()))).toBe("updated");
    expect(bcrypt.compareSync("Newest-Password-Mz4q-Tp8w", (await account()).passwordHash)).toBe(true);
  });

  it("does nothing for builds that do not say when the password was set", async () => {
    await ensurePlatformOwner(build("Old-Password-Kp7d-xQ2m", "2026-10-01T00:00:00.000Z"));
    const { PLATFORM_OWNER_PASSWORD_SET_AT: _unused, ...withoutTime } = build("Other-Password-R9tv-hW4z", "2026-10-21T00:00:00.000Z");
    expect(await ensurePlatformOwner(withoutTime)).toBe("exists");
    expect(bcrypt.compareSync("Old-Password-Kp7d-xQ2m", (await account()).passwordHash)).toBe(true);
  });
});
