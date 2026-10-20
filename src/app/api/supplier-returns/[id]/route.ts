import { route } from "@/lib/api";
import { getSupplierReturn } from "@/modules/procurement";

export const GET = route("purchases.view", async ({ params, svc }) => getSupplierReturn(svc, params.id));

export const dynamic = "force-dynamic";
