import { route, readJson } from "@/lib/api";
import { paymentSchema } from "@/lib/schemas";
import { paySupplier } from "@/services/ledger";

export const POST = route("suppliers.manage", async ({ req, params, user }) => paySupplier(params.id, paymentSchema.parse(await readJson(req)), user.id));

export const dynamic = "force-dynamic";
