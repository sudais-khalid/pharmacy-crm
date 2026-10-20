import { route } from "@/lib/api";
import { can } from "@/modules/identity";
import { batchTrace } from "@/modules/inventory";

/** Where a batch came from and where it went (recalls). Customer names and phones only with customers.view. */
export const GET = route("inventory.view", async ({ params, svc, user }) => {
  const t = await batchTrace(svc, params.id);
  if (can(user, "customers.view")) return t;
  return { ...t, holders: [], sales: t.sales.map((s) => ({ ...s, sale: { ...s.sale, customer: null, customerName: null, customerPhone: null } })) };
});

export const dynamic = "force-dynamic";
