import { route } from "@/lib/api";
import { getSettings } from "@/modules/platform";

/**
 * First-run setup (roadmap 9.9): what a new pharmacy has done so far. Every step links to the screen
 * that does it; customers and suppliers with balances can also be typed in on the setup page itself.
 */
export const GET = route("settings.manage", async ({ db, user }) => {
  const [settings, pharmacy, staff, stocked, customers, suppliers, owed, owing] = await Promise.all([
    getSettings(db, user.pharmacyId),
    db.pharmacy.findUniqueOrThrow({ where: { id: user.pharmacyId }, select: { address: true, phone: true, logoFileId: true } }),
    db.user.count({ where: { active: true, isSystem: false } }),
    db.batch.count({ where: { quantity: { gt: 0 } } }),
    db.customer.count(),
    db.supplier.count(),
    db.customerLedger.aggregate({ _sum: { debit: true, credit: true } }),
    db.supplierLedger.aggregate({ _sum: { debit: true, credit: true } }),
  ]);
  return {
    done: settings.setupDone,
    steps: {
      profile: { done: !!pharmacy.address.trim() && !!pharmacy.phone.trim(), logo: !!pharmacy.logoFileId },
      receipt: { done: true, format: settings.receiptFormat },
      staff: { done: staff > 1, count: staff },
      stock: { done: stocked > 0, batches: stocked },
      customers: { done: customers > 0, count: customers, owed: Number(owed._sum.debit ?? 0) - Number(owed._sum.credit ?? 0) },
      suppliers: { done: suppliers > 0, count: suppliers, owing: Number(owing._sum.debit ?? 0) - Number(owing._sum.credit ?? 0) },
    },
  };
});

export const dynamic = "force-dynamic";
