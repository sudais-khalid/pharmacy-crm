import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { tenantTransaction } from "@/lib/db";
import {
  createOrder, createSupplierReturn, endOrder, getOrder, importCatalog, listCatalog, ordersFromSuggestions, reorderSuggestions, saveCatalogItem, scanOverdueOrders, sendOrder, supplierBalance,
} from "@/modules/procurement";
import { createSale } from "@/modules/sales";
import { autoMatch, createIntake, getIntake, intakeDraftSchema, intakeFromOrder, postIntake, saveDraft } from "@/modules/stockentry";
import { resetDb, makeUser, makeMedicine, makeBatch, makeSupplier, ctxOf, inDays, pharmacyId } from "./helpers";

beforeEach(resetDb);

const stockOf = async (medicineId: string) => (await platformDb.batch.aggregate({ where: { medicineId }, _sum: { quantity: true } }))._sum.quantity ?? 0;
const newMedicine = { name: "Zyrtec 10mg Tablet", genericName: "Cetirizine", categoryId: null, barcode: null, sku: null, unit: "Pack", purchasePrice: 0, salePrice: 120, minStock: 5, prescriptionRequired: false, description: null, active: true };

describe("supplier catalogs", () => {
  it("add an existing medicine or a brand-new one in one step, with codes unique per supplier and one preferred supplier", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const s1 = await makeSupplier();
    const s2 = await platformDb.supplier.create({ data: { pharmacyId, name: "Other Distributor" } });
    const m = await makeMedicine("Monitor 5mg Tablet");
    await saveCatalogItem(c, s1.id, { medicineId: m.id, supplierCode: "808", lastPrice: 186.63, preferred: true });
    const fresh = await saveCatalogItem(c, s1.id, { newMedicine: newMedicine, supplierCode: "77", lastBonusRule: "10+1" });
    expect(fresh.medicine.name).toBe("Zyrtec 10mg Tablet");
    expect(await platformDb.medicine.count({ where: { name: "Zyrtec 10mg Tablet" } })).toBe(1);
    await expect(saveCatalogItem(c, s1.id, { medicineId: fresh.medicineId, supplierCode: "808" })).rejects.toThrow(/already used for Monitor/);
    // a second supplier becomes preferred: only one is
    await saveCatalogItem(c, s2.id, { medicineId: m.id, preferred: true });
    const preferred = await platformDb.supplierProduct.findMany({ where: { medicineId: m.id, preferred: true } });
    expect(preferred.map((p) => p.supplierId)).toEqual([s2.id]);
    expect((await listCatalog(c, s1.id)).map((i) => i.medicine.name)).toEqual(["Monitor 5mg Tablet", "Zyrtec 10mg Tablet"]);

    const r = await importCatalog(c, s1.id, [{ name: "monitor 5mg tablet", lastPrice: 190 }, { name: "Unknown Syrup", supplierCode: "999" }]);
    expect(r).toMatchObject({ updated: 1, unmatched: [{ name: "Unknown Syrup" }] });
    expect(Number((await platformDb.supplierProduct.findFirstOrThrow({ where: { supplierId: s1.id, medicineId: m.id } })).lastPrice)).toBe(190);
  });

  it("match bill lines by the supplier's code, and learn codes from posted bills", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const s = await makeSupplier();
    const monitor = await makeMedicine("Monitor 5mg Tablet");
    const pelton = await makeMedicine("Pelton V Suspension");
    await saveCatalogItem(c, s.id, { medicineId: monitor.id, supplierCode: "808" });
    const intake = await createIntake(c, { kind: "PURCHASE_BILL", source: "OCR" });
    await saveDraft(c, intake.id, intakeDraftSchema.parse({
      supplierId: s.id, supplierInvoice: "B-1",
      lines: [
        { rawText: "MNTR 5 TB / 808 UT274 1 03-28 186.63 187", name: "MNTR 5 TB", batchNumber: "UT274", expiryDate: inDays(400), quantity: 1, rate: 186.63 },
        { rawText: "PELTON-V 120ML SUSP / 4359 26G094 2 06-28 165.75 332", name: "PELTON-V 120ML SUSP", medicineId: pelton.id, matchMethod: "MANUAL", batchNumber: "26G094", expiryDate: inDays(500), quantity: 2, rate: 165.75 },
      ],
    }));
    await tenantTransaction(pharmacyId, (tx) => autoMatch(tx, intake.id, s.id));
    const lines = (await getIntake(c, intake.id)).lines;
    expect(lines[0]).toMatchObject({ medicineId: monitor.id, matchMethod: "SUPPLIER_CODE" });
    await postIntake(c, intake.id);
    const learned = await platformDb.supplierProduct.findFirstOrThrow({ where: { supplierId: s.id, medicineId: pelton.id } });
    expect(learned).toMatchObject({ supplierCode: "4359", lastBonusRule: null });
    expect(Number(learned.lastPrice)).toBe(165.75);
  });
});

describe("purchase orders", () => {
  it("move neither stock nor money until received; 60 of 100 leaves 40 pending, and stock rises by 60 plus bonus", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const s = await makeSupplier();
    const m = await makeMedicine("Augmentin 625mg");
    const order = await createOrder(c, { supplierId: s.id, items: [{ medicineId: m.id, orderedQty: 100, expectedPrice: 50 }] });
    expect(order).toMatchObject({ status: "DRAFT", source: "MANUAL" });
    expect(Number(order.estimatedTotal)).toBe(5000);
    expect(await stockOf(m.id)).toBe(0);
    expect(Number(await tenantTransaction(pharmacyId, (tx) => supplierBalance(tx, s.id)))).toBe(0);

    await expect(intakeFromOrder(c, order.id)).rejects.toThrow(/Send the order/);
    await sendOrder(c, order.id);
    const receipt = await intakeFromOrder(c, order.id);
    expect(await intakeFromOrder(c, order.id)).toMatchObject({ id: receipt.id, reused: true });
    const draft = await getIntake(c, receipt.id);
    expect(draft).toMatchObject({ supplier: { id: s.id }, order: { id: order.id } });
    expect(draft.lines[0]).toMatchObject({ medicineId: m.id, quantity: 100 });
    // only 60 arrived, with 6 free
    await saveDraft(c, receipt.id, intakeDraftSchema.parse({
      supplierId: s.id, purchaseOrderId: order.id, supplierInvoice: "INV-60",
      lines: [{ name: draft.lines[0].name, medicineId: m.id, matchMethod: "MANUAL", batchNumber: "A1", expiryDate: inDays(400), quantity: 60, bonusQty: 6, rate: 50 }],
    }));
    await postIntake(c, receipt.id);
    let after = await getOrder(c, order.id);
    expect(after.status).toBe("PARTIALLY_RECEIVED");
    expect(after.items[0]).toMatchObject({ orderedQty: 100, receivedQty: 60, pendingQty: 40 });
    expect(after.purchases).toHaveLength(1);
    expect(await stockOf(m.id)).toBe(66);

    // the rest never comes: close short
    await endOrder(c, order.id, "Supplier out of stock");
    after = await getOrder(c, order.id);
    expect(after).toMatchObject({ status: "CLOSED", closeReason: "Supplier out of stock" });
    await expect(intakeFromOrder(c, order.id)).rejects.toThrow(/closed/);
  });

  it("are cancelled when nothing came, received in full, and flagged when overdue", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const s = await makeSupplier();
    const m = await makeMedicine("Brufen 400mg");
    const cancelled = await createOrder(c, { supplierId: s.id, items: [{ medicineId: m.id, orderedQty: 5 }] });
    expect((await endOrder(c, cancelled.id, "Ordered by mistake")).status).toBe("CANCELLED");

    const late = await createOrder(c, { supplierId: s.id, items: [{ medicineId: m.id, orderedQty: 10, expectedPrice: 20 }], expectedDate: inDays(-2) });
    await sendOrder(c, late.id);
    expect(await scanOverdueOrders(pharmacyId)).toMatchObject({ raised: 1 });
    expect(await scanOverdueOrders(pharmacyId)).toMatchObject({ raised: 0 });
    const receipt = await intakeFromOrder(c, late.id);
    await saveDraft(c, receipt.id, intakeDraftSchema.parse({
      supplierId: s.id, purchaseOrderId: late.id, lines: [{ name: "Brufen", medicineId: m.id, matchMethod: "MANUAL", batchNumber: "B1", expiryDate: inDays(300), quantity: 10, rate: 20 }],
    }));
    await postIntake(c, receipt.id);
    expect((await getOrder(c, late.id)).status).toBe("RECEIVED");
    expect(await scanOverdueOrders(pharmacyId)).toMatchObject({ resolved: 1 });
    await expect(endOrder(c, late.id, "again")).rejects.toThrow(/already finished/);
  });
});

describe("reorder suggestions", () => {
  it("suggest what runs low, from the preferred supplier, less what is on order, and make one draft per supplier", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const s1 = await makeSupplier();
    const s2 = await platformDb.supplier.create({ data: { pharmacyId, name: "Second Supplier" } });
    const low = await makeMedicine("Risek 20mg", { minStock: 10 });
    const fine = await makeMedicine("Calpol", { minStock: 5 });
    const other = await makeMedicine("Flagyl", { minStock: 4 });
    await makeBatch(low.id, "L1", 300, 14);
    await makeBatch(fine.id, "F1", 300, 50);
    await makeBatch(other.id, "O1", 300, 2);
    await saveCatalogItem(c, s1.id, { medicineId: low.id, preferred: true, lastPrice: 60, leadTimeDays: 3 });
    await saveCatalogItem(c, s2.id, { medicineId: other.id, preferred: true });
    // 6 of 14 sold: 8 left, below the minimum of 10
    await createSale(c, { items: [{ medicineId: low.id, quantity: 6 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CASH" });

    const list = await reorderSuggestions({ pharmacyId });
    // grouped by supplier name: Second Supplier, then Test Supplier
    expect(list.map((x) => x.name)).toEqual(["Flagyl", "Risek 20mg"]);
    expect(list[1]).toMatchObject({ stock: 8, onOrder: 0, supplierId: s1.id, suggestedQty: 12, lastPrice: 60 }); // up to 2 x minimum
    expect(list[0]).toMatchObject({ supplierId: s2.id, suggestedQty: 6 });

    const made = await ordersFromSuggestions(c, list.map((x) => ({ medicineId: x.medicineId, supplierId: x.supplierId!, quantity: x.suggestedQty })));
    expect(made).toHaveLength(2);
    expect(await platformDb.purchaseOrder.count({ where: { source: "SUGGESTED", status: "DRAFT" } })).toBe(2);
    // what is on order is not suggested again
    expect(await reorderSuggestions({ pharmacyId })).toEqual([]);
  });
});

describe("supplier returns", () => {
  it("take the stock out of its batch at cost and credit the supplier", async () => {
    const u = await makeUser("PHARMACIST");
    const c = ctxOf(u);
    const s = await makeSupplier();
    const m = await makeMedicine("Ventolin Syrup");
    const intake = await createIntake(c, { kind: "PURCHASE_BILL", source: "MANUAL" });
    await saveDraft(c, intake.id, intakeDraftSchema.parse({
      supplierId: s.id, supplierInvoice: "R-1", lines: [{ name: "Ventolin", medicineId: m.id, matchMethod: "MANUAL", batchNumber: "V1", expiryDate: inDays(40), quantity: 10, rate: 100 }],
    }));
    await postIntake(c, intake.id);
    const batch = await platformDb.batch.findFirstOrThrow({ where: { batchNumber: "V1" } });
    await platformDb.batch.update({ where: { id: batch.id }, data: { setAsideAt: new Date() } });
    const before = Number(await tenantTransaction(pharmacyId, (tx) => supplierBalance(tx, s.id)));

    await expect(createSupplierReturn(c, { supplierId: s.id, reason: "Near expiry", items: [{ batchId: batch.id, quantity: 11 }] })).rejects.toThrow(/Only 10/);
    const ret = await createSupplierReturn(c, { supplierId: s.id, reason: "Near expiry", items: [{ batchId: batch.id, quantity: 10 }] });
    expect(ret.number).toMatch(/^RTS-\d{8}-00001$/);
    expect(Number(ret.total)).toBe(1000);
    expect(await platformDb.batch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ quantity: 0, setAsideAt: null });
    expect(await platformDb.stockMovement.findFirst({ where: { reference: ret.number } })).toMatchObject({ type: "SUPPLIER_RETURN", quantity: -10, balanceAfter: 0 });
    expect(Number(await tenantTransaction(pharmacyId, (tx) => supplierBalance(tx, s.id)))).toBe(before - 1000);
  });
});
