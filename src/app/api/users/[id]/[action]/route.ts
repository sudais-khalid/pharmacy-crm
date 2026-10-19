import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { forceLogout, issueStaffReset, setTemporaryPassword } from "@/modules/identity";

/** reset-link and temporary-password are shown once to the person who asked; logout ends every session. */
const ACTIONS = { "reset-link": issueStaffReset, "temporary-password": setTemporaryPassword, logout: forceLogout } as const;

export const POST = route("users.manage", async ({ params, svc }) => {
  const action = ACTIONS[params.action as keyof typeof ACTIONS];
  if (!action) throw new AppError(404, "Unknown action.");
  return action(svc, params.id);
});

export const dynamic = "force-dynamic";
