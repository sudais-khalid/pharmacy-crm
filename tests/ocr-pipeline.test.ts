import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { tenantTransaction } from "@/lib/db";
import { getSettings, readUsage, updateSettings } from "@/modules/platform";
import { setPharmacyPlan } from "@/modules/tenancy";
import { claimNextIntake, cloudProvider, getIntake, processIntake, retryReading, uploadPhotos, usageKey, type OcrProvider, type ParsedIntake } from "@/modules/stockentry";
import { resetDb, makeUser, makeMedicine, ctxOf, pharmacyId } from "./helpers";
import { testPng } from "./png";

beforeEach(resetDb);

const reading: ParsedIntake = {
  header: { supplierName: "Muller and Phipps", invoiceNo: "45812", billDate: "2026-10-12", billTotal: 280, confidence: 0.9 },
  lines: [{ rawText: "PANADOL 500MG TAB B771 04/28 100 10 2.80 280.00", name: "PANADOL 500MG TAB", batchNumber: "B771", expiryDate: "2028-04-30", quantity: 100, bonusQty: 10, rate: 2.8, discountPercent: null, taxAmount: null, amount: 280, confidence: 0.92, box: { page: 1, x: 0.05, y: 0.3, w: 0.9, h: 0.03 } }],
};
const fake = (result: ParsedIntake | Error): OcrProvider => ({
  name: "LOCAL",
  extract: async () => {
    if (result instanceof Error) throw result;
    return { provider: "LOCAL", pages: [], structured: result };
  },
});

describe("photo stock entry", () => {
  it("is uploaded once, read in the worker, matched, counted and announced", async () => {
    const u = await makeUser("PHARMACIST");
    const m = await makeMedicine("Panadol 500mg Tablet");
    await platformDb.supplier.create({ data: { pharmacyId, name: "Muller & Phipps Pakistan" } });
    const photo = testPng(300, "bill-1");
    const up = await uploadPhotos(ctxOf(u), { kind: "PURCHASE_BILL", pages: [photo] });
    expect(up.duplicate).toBe(false);
    expect(await uploadPhotos(ctxOf(u), { kind: "PURCHASE_BILL", pages: [photo] })).toEqual({ id: up.id, duplicate: true });

    const claimed = await claimNextIntake();
    expect(claimed).toEqual({ id: up.id, pharmacyId });
    expect(await claimNextIntake()).toBeNull(); // nothing else waiting
    const r = await processIntake(pharmacyId, up.id, { LOCAL: fake(reading) });
    expect(r).toMatchObject({ status: "NEEDS_REVIEW", lines: 1 });

    const intake = await getIntake(ctxOf(u), up.id);
    expect(intake).toMatchObject({ status: "NEEDS_REVIEW", provider: "LOCAL", supplierInvoice: "45812", attempts: 1 });
    expect(intake.supplier?.name).toBe("Muller & Phipps Pakistan");
    expect(intake.lines[0]).toMatchObject({ medicineId: m.id, matchMethod: "TRIGRAM", batchNumber: "B771", quantity: 100, bonusQty: 10, confidence: 0.92 });
    expect(intake.lines[0].boxes).toMatchObject({ page: 1, y: 0.3 });
    expect(await tenantTransaction(pharmacyId, (tx) => readUsage(tx, usageKey()))).toBe(1);
    expect(await platformDb.notification.findFirst({ where: { type: "INTAKE_READY" } })).toMatchObject({ link: `/stock-entry/${up.id}`, audiencePermission: "stockEntry.post" });
  });

  it("fails clearly (photos kept) when reading is off, over the limit or unreadable, and can be retried", async () => {
    const u = await makeUser("PHARMACIST");
    const up = await uploadPhotos(ctxOf(u), { kind: "STOCK_LIST", pages: [testPng(200, "list"), testPng(200, "list-2")] });

    await platformDb.pharmacy.update({ where: { id: pharmacyId }, data: { ocrMonthlyLimit: 1 } });
    await claimNextIntake();
    await processIntake(pharmacyId, up.id, { LOCAL: fake(reading) });
    expect((await getIntake(ctxOf(u), up.id))).toMatchObject({ status: "FAILED", error: expect.stringMatching(/limit of 1 photo pages/) });

    await platformDb.pharmacy.update({ where: { id: pharmacyId }, data: { ocrMonthlyLimit: 100 } });
    await retryReading(ctxOf(u), up.id);
    await claimNextIntake();
    await processIntake(pharmacyId, up.id, { LOCAL: fake(new Error("engine crashed")) });
    expect((await getIntake(ctxOf(u), up.id))).toMatchObject({ status: "FAILED", error: expect.stringMatching(/engine crashed/), attempts: 2 });

    await platformDb.featureFlag.create({ data: { pharmacyId, key: "ocr", enabled: false } });
    await retryReading(ctxOf(u), up.id);
    await claimNextIntake();
    await processIntake(pharmacyId, up.id, { LOCAL: fake(reading) });
    expect((await getIntake(ctxOf(u), up.id)).error).toMatch(/switched off/);
    expect((await getIntake(ctxOf(u), up.id)).pages).toHaveLength(2);
  });

  it("refuses files that are not pictures", async () => {
    const u = await makeUser("PHARMACIST");
    await expect(uploadPhotos(ctxOf(u), { kind: "PURCHASE_BILL", pages: [Buffer.from("%PDF-1.7 ...")] })).rejects.toThrow(/not a JPEG, PNG or WebP/);
    await expect(uploadPhotos(ctxOf(u), { kind: "PURCHASE_BILL", pages: [] })).rejects.toThrow(/at least one photo/);
  });
});

describe("photo reader choice", () => {
  it("is limited to the readers the Developer allows, and the worker follows the choice", async () => {
    const u = await makeUser("ADMIN");
    const ctx = ctxOf(u);
    await expect(updateSettings(ctx, { expiryWarningDays: 90, currency: "PKR", ocrProvider: "CLOUD" })).rejects.toThrow(/not part of your plan/);
    await setPharmacyPlan({ devId: "dev-1" }, pharmacyId, { plan: "STANDARD", maxUsers: 10, ocrMonthlyLimit: 50, ocrProviders: ["LOCAL", "CLOUD"] });
    await updateSettings(ctx, { expiryWarningDays: 90, currency: "PKR", ocrProvider: "CLOUD" });
    const view = await tenantTransaction(pharmacyId, (tx) => getSettings(tx, pharmacyId));
    expect(view).toMatchObject({ ocrProviders: ["LOCAL", "CLOUD"], ocrProvider: "CLOUD", ocrMonthlyLimit: 50, ocrUsedThisMonth: 0 });

    const up = await uploadPhotos(ctx, { kind: "STOCK_LIST", pages: [testPng(120, "choice")] });
    await claimNextIntake();
    const cloud: OcrProvider = { name: "CLOUD", extract: async () => ({ provider: "CLOUD", pages: [], structured: reading }) };
    await processIntake(pharmacyId, up.id, { LOCAL: fake(new Error("should not be used")), CLOUD: cloud });
    expect(await getIntake(ctx, up.id)).toMatchObject({ status: "NEEDS_REVIEW", provider: "CLOUD" });

    // the Developer withdraws the cloud reader: the choice falls back to the computer
    await setPharmacyPlan({ devId: "dev-1" }, pharmacyId, { plan: "STANDARD", maxUsers: 10, ocrMonthlyLimit: 50, ocrProviders: ["LOCAL"] });
    expect((await tenantTransaction(pharmacyId, (tx) => getSettings(tx, pharmacyId))).ocrProvider).toBe("LOCAL");
  });
});

describe("cloud reader", () => {
  it("sends only the photos and maps the structured answer", async () => {
    let sent: { model: string; tool_choice: { name: string }; messages: { content: { type: string }[] }[] } | null = null;
    const fetchFn = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      sent = JSON.parse(init.body);
      expect(init.headers["x-api-key"]).toBe("test-key");
      return new Response(JSON.stringify({ content: [{ type: "tool_use", input: { supplier_name: "Ali Traders", invoice_no: "A-9", bill_date: "2026-10-12", bill_total: 500, lines: [{ text: "Augmentin 625 x 10 exp Apr-28", name: "Augmentin 625", expiry: "Apr-28", quantity: 10, confidence: 0.7, page: 1, box: [0.1, 0.2, 0.8, 0.04] }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const doc = await cloudProvider("test-key", "claude-test", fetchFn).extract([{ pageNo: 1, data: testPng(64), mime: "image/png" }], "STOCK_LIST");
    expect(sent!.model).toBe("claude-test");
    expect(sent!.tool_choice.name).toBe("record_document");
    expect(sent!.messages[0].content.filter((c) => c.type === "image")).toHaveLength(1);
    expect(doc.structured!.lines[0]).toMatchObject({ name: "Augmentin 625", quantity: 10, expiryDate: "2028-04-30", confidence: 0.7, box: { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.04 } });
    expect(doc.structured!.header).toMatchObject({ supplierName: "Ali Traders", invoiceNo: "A-9", billTotal: 500 });
  });
});
