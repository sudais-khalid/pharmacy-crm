import { route, readJson } from "@/lib/api";
import { paymentSchema } from "@/lib/validation";
import { paySupplier } from "@/modules/procurement";

export const POST = route("suppliers.manage", async ({ req, params, user }) => paySupplier(params.id, paymentSchema.parse(await readJson(req)), user.id));

export const dynamic = "force-dynamic";
