import { z } from "zod";
import { platformDb } from "@/lib/platform-db";
import { audit } from "./audit";

/**
 * Desktop installations only: the Electron main process asks the server before it acts on a Developer's
 * request from the console (back up now, mirror folder, restore). The server is the authority on who is
 * signed in; this records the action in the audit log before it happens.
 */
export const desktopActionSchema = z.object({
  action: z.enum(["backup", "mirror", "restore", "lan", "cloudOcr"]),
  code: z.string().trim().max(10).optional(),
  detail: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
});
export type DesktopAction = z.infer<typeof desktopActionSchema>;

export function isDesktopInstall() {
  return process.env.DEPLOY_MODE === "desktop";
}

export async function recordDesktopAction(c: { devId: string; meta?: { ip?: string | null; userAgent?: string | null } }, input: DesktopAction) {
  await audit(platformDb, { actor: { id: c.devId }, realm: "PLATFORM", meta: c.meta }, {
    action: `desktop.${input.action}`,
    entity: "Installation",
    entityId: "desktop",
    pharmacyId: null,
    after: input.detail ?? null,
  });
}
