import { route } from "@/lib/api";
import { ROLE_PERMISSIONS } from "@/modules/identity";

export const GET = route(null, async ({ user }) => ({ user, permissions: ROLE_PERMISSIONS[user.role] }));

export const dynamic = "force-dynamic";
