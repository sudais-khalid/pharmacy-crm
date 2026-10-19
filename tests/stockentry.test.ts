import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { tenantTransaction } from "@/lib/db";
import { autoMatch, createIntake, discardIntake, getIntake, intakeDraftSchema, matchMedicine, postIntake, saveDraft } from "@/modules/stockentry";
import { resetDb, makeUser, makeMedicine, makeSupplier, ctxOf, inDays, pharmacyId } from "./helpers";

beforeEach(resetDb);

const draft = (over: Record<string, unknown>) => intakeDraftSchema.parse({ lines: [], ...over });

describe("stock entry: supplier bill", () => {
  it("saves as typed, checks the rules, posts through the purchase code and learns the supplier's names", async () => {
    const u = await makeUser("PHARMACIST");
    const panadol = await makeMedicine("Panadol 500mg Tablet", { purchasePrice: 2.5, salePrice: 4 });
    const s = await makeSupplier();
    const intake = await createIntake(ctxOf(u), { kind: "PURCHASE_BILL", source: "MANUAL" });
    expect(intake.number).toMatch(/^SE-\d{8}-00001$/);

    const lines = [{ name: "PANADOL 500 MG TAB", batchNumber: "B771", expiryDate: inDays(400), quantity: 100, bonusQty: 10, rate: 2.8 }];
    let saved = await saveDraft(ctxOf(u), intake.id, draft({ lines, billTotal: 280 }));
    expect(saved.checks.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["supplierId", "medicineId"]));

    // the printed name finds the medicine by similarity
    await tenantTransaction(pharmacyId, (tx) => autoMatch(tx, intake.id, s.id));
    const matched = await getIntake(ctxOf(u), intake.id);
    expect(matched.lines[0]).toMatchObject({ medicineId: panadol.id, matchMethod: "TRIGRAM" });

    saved = await saveDraft(ctxOf(u), intake.id, draft({ supplierId: s.id, supplierInvoice: "45812", billTotal: 300, lines: [{ ...lines[0], medicineId: panadol.id, matchMethod: "TRIGRAM" }] }));
    expect(saved.checks.errors.map((e) => e.field)).toEqual(["billTotal"]); // 280 against 300
    expect(saved.checks.warnings.map((e) => e.field)).toContain("rate"); // 2.80 is 12% above 2.50
    await expect(postIntake(ctxOf(u), intake.id)).rejects.toThrow(/Lines add up to 280.00/);

    await saveDraft(ctxOf(u), intake.id, draft({ supplierId: s.id, supplierInvoice: "45812", billTotal: 300, note: "Delivery charge 20 on the bill", lines: [{ ...lines[0], medicineId: panadol.id, matchMethod: "TRIGRAM" }] }));
    const posted = await postIntake(ctxOf(u), intake.id);
    expect(posted.reference).toMatch(/^PUR-/);
    const purchase = await platformDb.purchase.findFirstOrThrow({ where: { intakeId: intake.id }, include: { items: true } });
    expect(purchase.items[0]).toMatchObject({ quantity: 100, bonusQty: 10 });
    expect((await platformDb.batch.findFirstOrThrow({ where: { medicineId: panadol.id } })).quantity).toBe(110);

    // the reviewer's match is remembered for this supplier
    const next = await tenantTransaction(pharmacyId, (tx) => matchMedicine(tx, "Panadol 500 mg tab.", s.id));
    expect(next).toMatchObject({ medicineId: panadol.id, method: "ALIAS" });

    await expect(postIntake(ctxOf(u), intake.id)).rejects.toThrow(/Already posted as PUR-/);
    await expect(discardIntake(ctxOf(u), intake.id)).rejects.toThrow(/cannot be discarded/);
    await expect(saveDraft(ctxOf(u), intake.id, draft({}))).rejects.toThrow(/can no longer be changed/);
  });

  it("blocks past expiry, missing batches and a bill entered twice", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine("Brufen 400");
    const s = await makeSupplier();
    const first = await createIntake(ctxOf(u), { kind: "PURCHASE_BILL", source: "MANUAL" });
    await saveDraft(ctxOf(u), first.id, draft({ supplierId: s.id, supplierInvoice: "A-1", lines: [{ medicineId: m.id, batchNumber: "K1", expiryDate: inDays(300), quantity: 5, rate: 40 }] }));
    await postIntake(ctxOf(u), first.id);

    const again = await createIntake(ctxOf(u), { kind: "PURCHASE_BILL", source: "MANUAL" });
    const r = await saveDraft(ctxOf(u), again.id, draft({ supplierId: s.id, supplierInvoice: "A-1", lines: [
      { medicineId: m.id, batchNumber: null, expiryDate: inDays(-1), quantity: 0, rate: 40 },
    ] }));
    expect(r.checks.errors.map((e) => e.field).sort()).toEqual(["batchNumber", "expiryDate", "quantity", "supplierInvoice"]);
  });
});

describe("stock entry: stock list", () => {
  it("adds opening batches with their movements, no supplier and no ledger", async () => {
    const u = await makeUser("ADMIN");
    const m = await makeMedicine("Amoxil 250mg Syrup", { salePrice: 180, purchasePrice: 120 });
    const intake = await createIntake(ctxOf(u), { kind: "STOCK_LIST", source: "MANUAL" });
    await saveDraft(ctxOf(u), intake.id, draft({ lines: [{ medicineId: m.id, batchNumber: "AX9", expiryDate: inDays(200), quantity: 24 }] }));
    const r = await postIntake(ctxOf(u), intake.id);
    expect(r.reference).toBe(intake.number);
    const batch = await platformDb.batch.findFirstOrThrow({ where: { medicineId: m.id } });
    expect(batch.quantity).toBe(24);
    expect(Number(batch.purchasePrice)).toBe(120);
    expect(await platformDb.stockMovement.findFirstOrThrow({ where: { batchId: batch.id } })).toMatchObject({ type: "OPENING", quantity: 24, reference: intake.number });
    expect(await platformDb.supplierLedger.count()).toBe(0);
  });
});
