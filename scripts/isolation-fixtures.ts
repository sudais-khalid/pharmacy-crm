/**
 * Creates a second pharmacy with one of every business record, for the HTTP isolation check.
 * Prints JSON with its sign-in details and record ids. Safe to run repeatedly (new URL name each time).
 *
 *   DATABASE_URL=... npx tsx scripts/isolation-fixtures.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const bcrypt = (await import("bcryptjs")).default;
  const { platformDb } = await import("../src/lib/platform-db");
  const { serviceContext, createRole, ADMIN_ROLE_ID, ALL_PERMISSIONS } = await import("../src/modules/identity");
  const { createSale } = await import("../src/modules/sales");
  const { createPurchase } = await import("../src/modules/procurement");
  const { addDays, todayStr, dateOnly } = await import("../src/lib/dates");

  const slug = `isolation-${Date.now().toString(36)}`;
  const password = "Isolation-check-123";
  const pharmacy = await platformDb.pharmacy.create({ data: { slug, name: "Isolation Bravo", settings: { create: {} } } });
  const pharmacyId = pharmacy.id;
  const admin = await platformDb.user.create({
    data: { pharmacyId, name: "Bravo Admin", username: "badmin", email: `badmin@${slug}.example`, roleId: ADMIN_ROLE_ID, passwordHash: await bcrypt.hash(password, 10) },
  });
  const ctx = serviceContext({ id: admin.id, permissions: ALL_PERMISSIONS }, pharmacyId);
  const role = await createRole(ctx, { name: "Bravo Only Role", permissions: ["pos.use"], landingPath: "/pos" });
  const { setLogo } = await import("../src/modules/platform");
  const { testPng } = await import("../tests/png");
  const logo = await setLogo(ctx, { logo: testPng(128, slug), icon: testPng(64, slug) });
  const medicine = await platformDb.medicine.create({ data: { pharmacyId, name: "Bravo Only Syrup", barcode: `B-${slug}`, salePrice: 90, purchasePrice: 60 } });
  const batch = await platformDb.batch.create({
    data: { pharmacyId, medicineId: medicine.id, batchNumber: "BRAVO-1", expiryDate: dateOnly(addDays(todayStr(), 300)), quantity: 40, salePrice: 90, purchasePrice: 60 },
  });
  const customer = await platformDb.customer.create({ data: { pharmacyId, name: "Bravo Only Customer", phone: "0399-9999999", creditLimit: 10000 } });
  const supplier = await platformDb.supplier.create({ data: { pharmacyId, name: "Bravo Only Supplier" } });
  const sale = await createSale(ctx, { items: [{ medicineId: medicine.id, quantity: 2 }], discountType: "AMOUNT", discountValue: 0, paymentMethod: "CREDIT", customerId: customer.id });
  const purchase = await createPurchase(ctx, {
    supplierId: supplier.id, purchaseDate: todayStr(), discount: 0, paid: 0, paymentMethod: "CASH",
    items: [{ medicineId: medicine.id, batchNumber: "BRAVO-2", expiryDate: addDays(todayStr(), 400), quantity: 10, purchasePrice: 60, salePrice: 90 }],
  });

  const { createIntake, saveDraft, intakeDraftSchema } = await import("../src/modules/stockentry");
  const intake = await createIntake(ctx, { kind: "STOCK_LIST", source: "MANUAL" });
  await saveDraft(ctx, intake.id, intakeDraftSchema.parse({ lines: [{ name: medicine.name, medicineId: medicine.id, batchNumber: "BRAVO-3", expiryDate: addDays(todayStr(), 500), quantity: 5 }] }));

  const { createReturn } = await import("../src/modules/sales");
  const [saleItem] = await platformDb.saleItem.findMany({ where: { saleId: sale.id } });
  const saleReturn = await createReturn(ctx, { saleId: sale.id, refundMethod: "CREDIT", reason: "Bravo return", items: [{ saleItemId: saleItem.id, quantity: 1, restock: true }] });
  const cashSession = await platformDb.cashSession.create({ data: { pharmacyId, userId: admin.id, openingFloat: 100 } });
  const { createOrder, createSupplierReturn, saveCatalogItem } = await import("../src/modules/procurement");
  const catalogItem = await saveCatalogItem(ctx, supplier.id, { medicineId: medicine.id, supplierCode: "B1" });
  const order = await createOrder(ctx, { supplierId: supplier.id, items: [{ medicineId: medicine.id, orderedQty: 3 }] });
  const supplierReturn = await createSupplierReturn(ctx, { supplierId: supplier.id, reason: "Bravo return", items: [{ batchId: batch.id, quantity: 1 }] });
  const { saveCategory, createExpense } = await import("../src/modules/finance");
  const expenseCategory = await saveCategory(ctx, { name: "Bravo upkeep" });
  const expense = await createExpense(ctx, { categoryId: expenseCategory.id, amount: 75, date: todayStr(), method: "CARD", description: "Bravo signboard" });

  console.log(JSON.stringify({
    pharmacy: slug,
    admin: { username: "badmin", password },
    ids: { medicine: medicine.id, batch: batch.id, customer: customer.id, supplier: supplier.id, sale: sale.id, purchase: purchase.id, user: admin.id, role: role.id, file: logo.logoFileId, intake: intake.id, saleReturn: saleReturn.id, cashSession: cashSession.id, saleItem: saleItem.id, catalogItem: catalogItem.id, order: order.id, supplierReturn: supplierReturn.id, expense: expense.id, expenseCategory: expenseCategory.id },
    names: { medicine: medicine.name, customer: customer.name, supplier: supplier.name, invoice: sale.invoiceNo, purchase: purchase.number },
  }));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
