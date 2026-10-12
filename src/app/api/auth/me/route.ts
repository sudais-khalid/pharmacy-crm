import { route } from "@/lib/api";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

export const GET = route(null, async ({ user }) => ({ user, permissions: ROLE_PERMISSIONS[user.role] }));

export const dynamic = "force-dynamic";
