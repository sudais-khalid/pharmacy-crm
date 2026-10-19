import { route } from "@/lib/api";
import { getSession } from "@/modules/sales";

export const GET = route("pos.use", async ({ params, svc }) => getSession(svc, params.id));

export const dynamic = "force-dynamic";
