import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";
import { runInTx, tenantTransaction } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, dateOnly, todayStr } from "@/lib/dates";
import { D, ZERO } from "@/lib/money";
import type { ServiceContext } from "@/modules/identity";
import { audit, nextNumber, raiseOnce, resolveStale } from "@/modules/platform";

/**
 * Purchase orders (roadmap 7.4 to 7.10; data model, section 4.2). An order never moves stock or money:
 *
 *   DRAFT -> SENT -> PARTIALLY_RECEIVED -> RECEIVED
 *   DRAFT or SENT -> CANCELLED (nothing received);  SENT or PARTIALLY_RECEIVED -> CLOSED (closed short)
 *
 * Receiving goes through a stock entry; the posted purchase adds its paid quantities to the order
 * (bonus units do not count against it) and moves the status on.
 */
export type OrderItemInput = { medicineId: string; orderedQty: number; expectedPrice?: number | null };
export type OrderInput = { supplierId: string; items: OrderItemInput[]; expectedDate?: string | null; note?: string | null; source?: "MANUAL" | "SUGGESTED" };

export const orderInclude = {
  supplier: { select: { id: true, name: true, phone: true, contactPerson: true } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  items: { include: { medicine: { select: { id: true, name: true, unit: true, genericName: true } } }, orderBy: { medicine: { name: "asc" } } },
  purchases: { select: { id: true, number: true, purchaseDate: true, total: true, supplierInvoice: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.PurchaseOrderInclude;

const OPEN = ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] as const;

async function priced(tx: Tx, supplierId: string, items: OrderItemInput[]) {
  const merged = new Map<string, OrderItemInput>();
  for (const i of items) {
    const prev = merged.get(i.medicineId);
    merged.set(i.medicineId, { medicineId: i.medicineId, orderedQty: (prev?.orderedQty ?? 0) + i.orderedQty, expectedPrice: i.expectedPrice ?? prev?.expectedPrice ?? null });
  }
  const ids = [...merged.keys()];
  const [medicines, catalog] = await Promise.all([
    tx.medicine.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, purchasePrice: true, active: true } }),
    tx.supplierProduct.findMany({ where: { supplierId, medicineId: { in: ids } }, select: { medicineId: true, lastPrice: true, leadTimeDays: true } }),
  ]);
  const out = [...merged.values()].map((i) => {
    const m = medicines.find((x) => x.id === i.medicineId);
    if (!m) throw new AppError(404, "Medicine not found.");
    if (!m.active) throw new AppError(409, `${m.name} is archived and cannot be ordered.`);
    const c = catalog.find((x) => x.medicineId === i.medicineId);
    const price = i.expectedPrice ?? (c?.lastPrice != null ? Number(c.lastPrice) : Number(m.purchasePrice) || null);
    return { medicineId: i.medicineId, orderedQty: i.orderedQty, expectedPrice: price !== null ? D(price).toDecimalPlaces(2) : null };
  });
  const total = out.reduce((s, i) => s.plus(i.expectedPrice ? i.expectedPrice.mul(i.orderedQty) : ZERO), ZERO).toDecimalPlaces(2);
  const lead = Math.max(0, ...catalog.map((c) => c.leadTimeDays));
  return { items: out, total, lead: catalog.length ? lead : 2 };
}

export async function createOrder(ctx: ServiceContext, input: OrderInput) {
  return runInTx(ctx, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, active: true } });
    if (!supplier) throw new AppError(404, "Supplier not found.");
    if (!supplier.active) throw new AppError(409, "This supplier is inactive.");
    if (!input.items.length) throw new AppError(400, "Add at least one medicine to the order.");
    const { items, total, lead } = await priced(tx, supplier.id, input.items);
    const n = await nextNumber(tx, "PURCHASE_ORDER");
    const number = `PO-${todayStr().replace(/-/g, "")}-${String(n).padStart(5, "0")}`;
    const order = await tx.purchaseOrder.create({
      data: {
        number, supplierId: supplier.id, source: input.source ?? "MANUAL", note: input.note?.trim() || null, estimatedTotal: total, createdById: ctx.actor.id,
        expectedDate: dateOnly(input.expectedDate ?? addDays(todayStr(), lead)),
        items: { create: items },
      },
    });
    await audit(tx, ctx, { action: "po.create", entity: "PurchaseOrder", entityId: order.id, after: { number, supplier: supplier.name, lines: items.length, estimatedTotal: total, source: order.source } });
    return order;
  });
}

async function lockOrder(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`);
  if (!row) throw new AppError(404, "Order not found.");
  return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
}

/** Changes a draft: its lines, expected date and note. */
export async function updateOrder(ctx: ServiceContext, id: string, input: Omit<OrderInput, "supplierId" | "source">) {
  return runInTx(ctx, async (tx) => {
    const order = await lockOrder(tx, id);
    if (order.status !== "DRAFT") throw new AppError(409, "Only a draft order can be changed. Close it and make a new one.");
    if (!input.items.length) throw new AppError(400, "Add at least one medicine to the order.");
    const { items, total } = await priced(tx, order.supplierId, input.items);
    await tx.purchaseOrderItem.deleteMany({ where: { orderId: id } });
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { estimatedTotal: total, note: input.note?.trim() || null, ...(input.expectedDate ? { expectedDate: dateOnly(input.expectedDate) } : {}), items: { create: items } },
    });
    await audit(tx, ctx, { action: "po.update", entity: "PurchaseOrder", entityId: id, before: { lines: order.items.length, estimatedTotal: order.estimatedTotal }, after: { lines: items.length, estimatedTotal: total } });
    return updated;
  });
}

/** Approves and sends a draft (po.approve): from now on it can be received against. */
export async function sendOrder(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const order = await lockOrder(tx, id);
    if (order.status !== "DRAFT") throw new AppError(409, "This order has already been sent.");
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), approvedById: ctx.actor.id } });
    await audit(tx, ctx, { action: "po.send", entity: "PurchaseOrder", entityId: id, before: { status: "DRAFT" }, after: { status: "SENT" } });
    return updated;
  });
}

/** Cancels an order nothing was received on, or closes one short (the rest will not come). */
export async function endOrder(ctx: ServiceContext, id: string, reason: string) {
  return runInTx(ctx, async (tx) => {
    const order = await lockOrder(tx, id);
    const received = order.items.some((i) => i.receivedQty > 0);
    if (!(OPEN as readonly string[]).includes(order.status)) throw new AppError(409, "This order is already finished.");
    const status = received ? "CLOSED" : "CANCELLED";
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status, closedAt: new Date(), closeReason: reason } });
    await audit(tx, ctx, { action: received ? "po.close" : "po.cancel", entity: "PurchaseOrder", entityId: id, before: { status: order.status }, after: { status, reason } });
    return updated;
  });
}

/**
 * Adds a posted purchase's quantities to its order (called by createPurchase, in its transaction). Lines
 * for medicines not on the order are simply not counted.
 */
export async function applyReceipt(tx: Tx, orderId: string, supplierId: string, lines: { medicineId: string; quantity: number }[]) {
  const order = await lockOrder(tx, orderId);
  if (order.supplierId !== supplierId) throw new AppError(400, "This order is for another supplier.");
  if (!["DRAFT", "SENT", "PARTIALLY_RECEIVED"].includes(order.status)) throw new AppError(409, `Order ${order.number} is ${order.status.toLowerCase().replace("_", " ")}; it cannot receive more.`);
  for (const l of lines) {
    const item = order.items.find((i) => i.medicineId === l.medicineId);
    if (!item) continue;
    const received = item.receivedQty + l.quantity;
    if (received > item.orderedQty * 2) throw new AppError(409, `More than twice the ordered quantity would be received for one line of ${order.number}.`);
    item.receivedQty = received;
    await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: received } });
  }
  const done = order.items.every((i) => i.receivedQty >= i.orderedQty);
  const status = done ? "RECEIVED" : order.items.some((i) => i.receivedQty > 0) ? "PARTIALLY_RECEIVED" : order.status === "DRAFT" ? "SENT" : order.status;
  await tx.purchaseOrder.update({ where: { id: orderId }, data: { status, ...(order.status === "DRAFT" ? { sentAt: new Date() } : {}) } });
  return status;
}

export async function getOrder(ctx: ServiceContext, id: string) {
  return runInTx(ctx, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new AppError(404, "Order not found.");
    return { ...order, items: order.items.map((i) => ({ ...i, pendingQty: Math.max(0, i.orderedQty - i.receivedQty) })) };
  });
}

export async function listOrders(ctx: ServiceContext, filter: { supplierId?: string; status?: "open" | "all" | string; page?: number }) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = 25;
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
    ...(filter.status === "open" ? { status: { in: [...OPEN] } } : filter.status && filter.status !== "all" ? { status: filter.status as Prisma.PurchaseOrderWhereInput["status"] } : {}),
  };
  return runInTx(ctx, async (tx) => {
    const [total, rows] = await Promise.all([
      tx.purchaseOrder.count({ where }),
      tx.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { supplier: { select: { id: true, name: true } }, items: { select: { orderedQty: true, receivedQty: true } } } }),
    ]);
    const items = rows.map(({ items: lines, ...o }) => ({
      ...o, lines: lines.length,
      ordered: lines.reduce((n, l) => n + l.orderedQty, 0), received: lines.reduce((n, l) => n + l.receivedQty, 0),
      pending: lines.reduce((n, l) => n + Math.max(0, l.orderedQty - l.receivedQty), 0),
    }));
    return { total, page, pageSize, items };
  });
}

/** A short message to send the order by WhatsApp or SMS. */
export function orderShareText(order: { number: string; expectedDate: Date | null; supplier: { name: string }; items: { orderedQty: number; medicine: { name: string } }[] }, pharmacyName: string) {
  const lines = order.items.map((i, n) => `${n + 1}. ${i.medicine.name} x ${i.orderedQty}`);
  return [`Order ${order.number} from ${pharmacyName}`, `To: ${order.supplier.name}`, ...lines, order.expectedDate ? `Needed by ${order.expectedDate.toISOString().slice(0, 10)}` : "", "Thank you"].filter(Boolean).join("\n");
}

/** Orders past their expected date and not fully received (roadmap 7.10). One notification per order, resolved when it arrives or is closed. */
export async function scanOverdueOrders(pharmacyId: string, today = todayStr()) {
  return tenantTransaction(pharmacyId, async (tx) => {
    const late = await tx.purchaseOrder.findMany({
      where: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, expectedDate: { lt: dateOnly(today) } },
      select: { id: true, number: true, expectedDate: true, supplier: { select: { name: true } } },
    });
    const still = new Set<string>();
    let raised = 0;
    for (const o of late) {
      const dedupeKey = `po-overdue:${o.id}`;
      still.add(dedupeKey);
      const ok = await raiseOnce(tx, pharmacyId, {
        type: "PO_OVERDUE", dedupeKey, audiencePermission: "purchases.view", severity: "WARNING",
        title: `Order ${o.number} from ${o.supplier.name} is overdue`,
        body: `It was expected on ${o.expectedDate!.toISOString().slice(0, 10)}.`,
        link: `/orders/${o.id}`,
      });
      if (ok) raised++;
    }
    const resolved = await resolveStale(tx, pharmacyId, ["PO_OVERDUE"], still);
    return { raised, resolved };
  });
}
