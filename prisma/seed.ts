/* Development seed data. All people and businesses below are fictional. */
import bcrypt from "bcryptjs";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { platformDb as prisma } from "../src/lib/platform-db";
import { addDays, todayStr } from "../src/lib/dates";
import { createMedicine } from "../src/modules/catalog";
import { createPurchase } from "../src/modules/procurement";
import { createSale } from "../src/modules/sales";
import { SYSTEM_ROLES, createRole, ensureSystemRoles, serviceContext, type SystemRoleKey } from "../src/modules/identity";

/** A seeded user as a service actor, with the permissions of their template role. */
const actor = (u: { id: string; roleId: string }) => ({ id: u.id, permissions: Object.values(SYSTEM_ROLES).find((r) => r.id === u.roleId)!.permissions });

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const today = todayStr();

async function main() {
  // the demo accounts have published passwords: never in a real installation (roadmap 9.11)
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
    console.error("Refusing to load demo data with known passwords into a production database. Create pharmacies from the Developer console instead. (Throwaway test databases may set ALLOW_DEMO_SEED=1.)");
    process.exitCode = 1;
    return;
  }
  if ((await prisma.medicine.count()) > 0) {
    console.log("Database already contains data, so the seed is skipped. Run `npm run db:reset` for a clean start.");
    return;
  }

  await ensureSystemRoles(prisma);
  const pharmacy = await prisma.pharmacy.create({
    data: {
      slug: "demo", name: "Demo Pharmacy", address: "Shop 12, Main Bazaar, Mardan", phone: "0300-0000000", email: "info@demo-pharmacy.example", currency: "PKR",
      settings: { create: { expiryWarningDays: 90 } },
    },
  });
  const pharmacyId = pharmacy.id;

  const users = await Promise.all(
    [
      ["Admin User", "admin@example.com", "Admin@12345", "PHARMACY_ADMIN"],
      ["Sara Pharmacist", "pharmacist@example.com", "Pharmacist@12345", "PHARMACIST"],
      ["Bilal Cashier", "cashier@example.com", "Cashier@12345", "CASHIER"],
    ].map(async ([name, email, pw, role]) =>
      prisma.user.create({ data: { pharmacyId, name, email, username: email.split("@")[0], roleId: SYSTEM_ROLES[role as SystemRoleKey].id, passwordHash: await bcrypt.hash(pw, 10) } }),
    ),
  );
  const [admin, pharmacist, cashier] = users;
  // a custom role, as a pharmacy admin would make one
  await createRole(serviceContext(actor(admin), pharmacyId), { name: "Senior Cashier", description: "The counter, plus cancelling invoices and reprinting any receipt.", permissions: [...SYSTEM_ROLES.CASHIER.permissions, "sales.cancel", "sales.reprint.any"], landingPath: "/pos" });

  const catNames = ["Analgesics", "Antibiotics", "Antihistamines", "Vitamins & Supplements", "Gastrointestinal", "Cardiovascular", "Dermatology", "Diabetes", "Respiratory"];
  const cats: Record<string, string> = {};
  for (const n of catNames) cats[n] = (await prisma.category.create({ data: { pharmacyId, name: n } })).id;

  // name, generic, category, purchase, sale, rx, min, openingQty, batchExpiryDays
  const meds: [string, string, string, number, number, boolean, number, number, number][] = [
    ["Panadol 500mg", "Paracetamol", "Analgesics", 38, 48, false, 30, 240, 420],
    ["Brufen 400mg", "Ibuprofen", "Analgesics", 55, 70, false, 20, 150, 300],
    ["Disprin", "Aspirin", "Analgesics", 20, 28, false, 20, 120, 380],
    ["Augmentin 625mg", "Amoxicillin + Clavulanic acid", "Antibiotics", 310, 380, true, 15, 60, 240],
    ["Amoxil 500mg", "Amoxicillin", "Antibiotics", 120, 155, true, 15, 6, 200],
    ["Azomax 500mg", "Azithromycin", "Antibiotics", 260, 320, true, 10, 45, 150],
    ["Ciproxin 500mg", "Ciprofloxacin", "Antibiotics", 180, 225, true, 10, 40, 22],
    ["Avil Tablets", "Pheniramine", "Antihistamines", 30, 40, false, 20, 100, 330],
    ["Zyrtec 10mg", "Cetirizine", "Antihistamines", 90, 120, false, 20, 80, 280],
    ["Clarityne 10mg", "Loratadine", "Antihistamines", 95, 125, false, 15, 7, 360],
    ["Vitamin C 500mg", "Ascorbic acid", "Vitamins & Supplements", 60, 85, false, 25, 200, 500],
    ["Calcium + D3", "Calcium carbonate / Vitamin D3", "Vitamins & Supplements", 150, 195, false, 20, 90, 45],
    ["Centrum Adults", "Multivitamin", "Vitamins & Supplements", 780, 950, false, 8, 25, 540],
    ["Risek 20mg", "Omeprazole", "Gastrointestinal", 140, 175, false, 20, 110, 260],
    ["Motilium 10mg", "Domperidone", "Gastrointestinal", 85, 110, true, 15, 70, 310],
    ["ORS Sachet", "Oral rehydration salts", "Gastrointestinal", 18, 25, false, 40, 300, 600],
    ["Concor 5mg", "Bisoprolol", "Cardiovascular", 210, 260, true, 10, 50, 400],
    ["Norvasc 5mg", "Amlodipine", "Cardiovascular", 165, 205, true, 10, 3, 350],
    ["Lipitor 20mg", "Atorvastatin", "Cardiovascular", 340, 420, true, 10, 55, 460],
    ["Betnovate Cream", "Betamethasone", "Dermatology", 95, 125, true, 10, 40, 380],
    ["Fucidin Cream", "Fusidic acid", "Dermatology", 330, 400, true, 8, 20, 210],
    ["Glucophage 500mg", "Metformin", "Diabetes", 70, 95, true, 20, 130, 420],
    ["Ventolin Inhaler", "Salbutamol", "Respiratory", 380, 460, true, 8, 30, 500],
    ["Mucolyn Syrup", "Ambroxol", "Respiratory", 110, 145, false, 12, 8, 90],
    ["Expired Cough Syrup (demo)", "Dextromethorphan", "Respiratory", 100, 135, false, 5, 12, -25],
  ];

  const medRecords: { id: string; name: string; sale: number; buy: number }[] = [];
  let i = 0;
  for (const [name, generic, cat, buy, sell, rx, min, qty, exp] of meds) {
    i += 1;
    const m = await createMedicine(
      serviceContext(actor(admin), pharmacyId),
      { name, genericName: generic, categoryId: cats[cat], barcode: `890100${String(i).padStart(6, "0")}`, sku: `SKU-${String(i).padStart(4, "0")}`, unit: "Pack", purchasePrice: buy, salePrice: sell, minStock: min, prescriptionRequired: rx, description: null, active: true,
        opening: { batchNumber: `OP-${String(i).padStart(3, "0")}`, expiryDate: addDays(today, exp), quantity: qty } },
    );
    medRecords.push({ id: m.id, name, sale: sell, buy });
  }

  const suppliers = await Promise.all(
    [
      ["Alpha Pharma Distributors", "Imran Khan", "0300-1111111", "Net 30"],
      ["MediSupply Traders", "Farhan Ali", "0301-2222222", "Cash on delivery"],
      ["HealthLine Wholesale", "Nadia Rehman", "0302-3333333", "Net 15"],
    ].map(([name, contactPerson, phone, paymentTerms]) => prisma.supplier.create({ data: { pharmacyId, name, contactPerson, phone, paymentTerms, address: "Wholesale Market, Peshawar" } })),
  );

  // purchases: add a second, later-expiring batch for some medicines
  for (let p = 0; p < 6; p++) {
    const chosen = medRecords.slice(p * 3, p * 3 + 3);
    await createPurchase(
      serviceContext(actor(admin), pharmacyId),
      {
        supplierId: suppliers[p % 3].id, supplierInvoice: `SUP-${1000 + p}`, purchaseDate: addDays(today, -(20 - p * 3)),
        items: chosen.map((m, k) => ({ medicineId: m.id, batchNumber: `PB-${p}${k}`, expiryDate: addDays(today, 600 + k * 30), quantity: 60 + k * 20, purchasePrice: m.buy, salePrice: m.sale + 2 })),
        discount: p % 2 === 0 ? 100 : 0, paid: p % 3 === 0 ? 0 : 5000 + p * 1000, paymentMethod: "CASH", note: null,
      },
    );
  }

  const customers = await Promise.all(
    [
      ["Ahmed Raza", "0311-1000001", 10000],
      ["Fatima Noor", "0311-1000002", 5000],
      ["Usman Ghani", "0311-1000003", 8000],
      ["Ayesha Siddiqui", "0311-1000004", 8000],
      ["Hamid Shah", "0311-1000005", 0],
      ["Zainab Bibi", "0311-1000006", 2000],
    ].map(([name, phone, creditLimit]) => prisma.customer.create({ data: { pharmacyId, name: name as string, phone: phone as string, creditLimit: creditLimit as number, address: "Mardan" } })),
  );

  // ~14 days of sales history (skip the demo expired and low-stock items sometimes)
  const sellable = medRecords.filter((m) => !m.name.includes("Expired"));
  let count = 0;
  for (let d = 13; d >= 0; d--) {
    const perDay = 3 + Math.floor(rand() * 5);
    for (let n = 0; n < perDay; n++) {
      const at = new Date(Date.now() - d * 86400000 - Math.floor(rand() * 8) * 3600000);
      const lines = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ medicineId: pick(sellable).id, quantity: 1 + Math.floor(rand() * 3) }));
      const useCredit = rand() < 0.2;
      const customer = useCredit || rand() < 0.4 ? pick(customers.slice(0, 4)) : null;
      try {
        // same evaluation order as before so the seeded data stays identical
        const sale: Parameters<typeof createSale>[1] = { items: lines, customerId: customer?.id ?? null, discountType: "AMOUNT", discountValue: rand() < 0.15 ? 20 : 0, paymentMethod: useCredit ? "CREDIT" : rand() < 0.3 ? "CARD" : "CASH", amountPaid: useCredit ? 0 : undefined, note: null };
        const seller = rand() < 0.5 ? cashier : pharmacist;
        await createSale(serviceContext(actor(seller), pharmacyId), sale, { createdAt: at });
        count++;
      } catch (e) {
        // credit limit / stock issues in random data are fine: skip
      }
    }
  }
  console.log(`Seeded: ${users.length} users, ${meds.length} medicines, ${suppliers.length} suppliers, ${customers.length} customers, ${count} sales.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
