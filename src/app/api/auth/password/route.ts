import { z } from "zod";
import { route, readJson } from "@/lib/api";
import { changeOwnPassword, setStaffSession } from "@/modules/identity";

const schema = z.object({ currentPassword: z.string().min(1).max(100), newPassword: z.string().min(1).max(100) });

/** Signed-in staff change their own password; the session continues under the new session version. */
export const POST = route(null, async ({ req, user, svc }) => {
  const { currentPassword, newPassword } = schema.parse(await readJson(req));
  const updated = await changeOwnPassword(user.id, currentPassword, newPassword, svc.meta);
  await setStaffSession(updated);
  return { ok: true };
}, { allowPasswordChange: true });

export const dynamic = "force-dynamic";
