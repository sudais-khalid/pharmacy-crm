import { route, readJson } from "@/lib/api";
import { paymentSchema } from "@/lib/validation";
import { paySupplier } from "@/modules/procurement";

export const POST = route("suppliers.manage", async ({ req, params, svc }) => paySupplier(svc, params.id, paymentSchema.parse(await readJson(req))), { idempotent: true });

export const dynamic = "force-dynamic";
