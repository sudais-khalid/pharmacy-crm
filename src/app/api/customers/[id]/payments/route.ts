import { route, readJson } from "@/lib/api";
import { paymentSchema } from "@/lib/validation";
import { receiveCustomerPayment } from "@/modules/customers";

export const POST = route("customers.payments", async ({ req, params, svc }) =>
  receiveCustomerPayment(svc, params.id, paymentSchema.parse(await readJson(req))),
);

export const dynamic = "force-dynamic";
