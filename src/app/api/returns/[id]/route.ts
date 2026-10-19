import { route } from "@/lib/api";
import { getReturn } from "@/modules/sales";

export const GET = route("sales.view", async ({ params, svc }) => getReturn(svc, params.id));

export const dynamic = "force-dynamic";
