import { route, readJson } from "@/lib/api";
import { paymentSchema } from "@/lib/schemas";
import { receiveCustomerPayment } from "@/services/ledger";

export const POST = route("customers.payments", async ({ req, params, user }) =>
  receiveCustomerPayment(params.id, paymentSchema.parse(await readJson(req)), user.id),
);

export const dynamic = "force-dynamic";
