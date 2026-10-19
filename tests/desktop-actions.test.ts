import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { desktopActionSchema, isDesktopInstall, recordDesktopAction } from "@/modules/platform";
import { resetDb } from "./helpers";

beforeEach(resetDb);
const before = process.env.DEPLOY_MODE;
afterEach(() => {
  if (before === undefined) delete process.env.DEPLOY_MODE;
  else process.env.DEPLOY_MODE = before;
});

describe("desktop actions", () => {
  it("exist only on a desktop installation", () => {
    delete process.env.DEPLOY_MODE;
    expect(isDesktopInstall()).toBe(false);
    process.env.DEPLOY_MODE = "desktop";
    expect(isDesktopInstall()).toBe(true);
  });

  it("accept only the known actions with plain details", () => {
    expect(desktopActionSchema.safeParse({ action: "restore", code: "123456", detail: { file: "a.pcrmbak", createdAt: "2026-10-19T10:00:00Z" } }).success).toBe(true);
    expect(desktopActionSchema.safeParse({ action: "drop-database" }).success).toBe(false);
    expect(desktopActionSchema.safeParse({ action: "backup", detail: { nested: { a: 1 } } }).success).toBe(false);
  });

  it("are recorded as the Developer's own platform actions, outside any pharmacy", async () => {
    await recordDesktopAction({ devId: "dev-1", meta: { ip: "127.0.0.1", userAgent: "Electron" } }, { action: "restore", detail: { file: "x.pcrmbak" } });
    const row = await platformDb.auditLog.findFirstOrThrow({ where: { action: "desktop.restore" } });
    expect(row).toMatchObject({ realm: "PLATFORM", actorId: "dev-1", pharmacyId: null, entity: "Installation", entityId: "desktop", after: { file: "x.pcrmbak" }, ip: "127.0.0.1" });
  });
});
