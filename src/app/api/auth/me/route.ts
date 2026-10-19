import { route } from "@/lib/api";

export const GET = route(null, async ({ user }) => ({ user, permissions: user.permissions }));

export const dynamic = "force-dynamic";
