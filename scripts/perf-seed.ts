/**
 * Data for the performance check (roadmap 9.8): 20 pharmacies, the first with 20,000 medicines and the others
 * with 2,000, each with a Pharmacy Admin, customers, and 90 days of sales history (about 40 a day). Rows are
 * written in bulk with the platform client, so this takes a minute or two instead of hours of real sales.
 * Run by scripts/perf-check.mjs against its own throwaway database; prints the sign-in details as JSON.
 */
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

export const PERF_PASSWORD = "Perf-check-pass-1";
const PHARMACIES = 20;
const BIG = 20_000;
const SMALL = 2_000;
const DAYS = 90;
const SALES_PER_DAY = 40;
const GENERICS = ["Paracetamol", "Amoxicillin", "Ibuprofen", "Metronidazole", "Omeprazole", "Cetirizine", "Metformin", "Atorvastatin", "Amlodipine", "Losartan", "Ciprofloxacin", "Azithromycin", "Cefixime", "Diclofenac", "Domperidone", "Salbutamol", "Montelukast", "Prednisolone", "Pantoprazole", "Pregabalin"];
const FORMS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Cream"];

async function main() {
  const { platformDb: db } = await import("../src/lib/platform-db");
  const { ADMIN_ROLE_ID, ensureSystemRoles } = await import("../src/modules/identity");
  await ensureSystemRoles(db);
  const hash = await bcrypt.hash(PERF_PASSWORD, 10);
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const chunks = async <T,>(rows: T[], write: (part: T[]) => Promise<unknown>, size = 5000) => { for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size)); };
  const out: { slug: string; username: string; medicines: number }[] = [];

  for (let p = 0; p < PHARMACIES; p++) {
    const slug = `perf-${String(p + 1).padStart(2, "0")}`;
    const pharmacy = await db.pharmacy.create({ data: { slug, name: `Perf Pharmacy ${p + 1}`, phone: "051-0000000", address: "Test Road", settings: { create: { setupDoneAt: new Date() } } } });
    const pharmacyId = pharmacy.id;
    const admin = await db.user.create({ data: { pharmacyId, name: `Admin ${p + 1}`, username: "admin", email: `admin@${slug}.example`, passwordHash: hash, roleId: ADMIN_ROLE_ID } });

    const count = p === 0 ? BIG : SMALL;
    const meds = Array.from({ length: count }, (_, i) => {
      const price = 20 + Math.floor(rand() * 480);
      return { id: randomUUID(), pharmacyId, name: `${pick(["Pana", "Bru", "Flagy", "Ome", "Zyr", "Gluco", "Lipi", "Norva", "Cozaa", "Cipro"])}${i.toString(36)} ${10 + Math.floor(rand() * 990)}mg ${FORMS[i % FORMS.length]}`, genericName: pick(GENERICS), barcode: `P${p}B${i}`, salePrice: price, purchasePrice: Math.round(price * 0.75), minStock: 10 };
    });
    await chunks(meds, (part) => db.medicine.createMany({ data: part }));
    const expiry = new Date(Date.UTC(2028, 11, 31));
    const batches = meds.map((m) => ({ id: randomUUID(), pharmacyId, medicineId: m.id, batchNumber: `B${m.barcode}`, expiryDate: expiry, quantity: 100_000, purchasePrice: m.purchasePrice, salePrice: m.salePrice }));
    await chunks(batches, (part) => db.batch.createMany({ data: part }));
    const customers = Array.from({ length: 300 }, (_, i) => ({ id: randomUUID(), pharmacyId, name: `Customer ${i + 1}`, phone: `0300-${String(1000000 + i)}`, creditLimit: 20000 }));
    await db.customer.createMany({ data: customers });

    const sales: { id: string; pharmacyId: string; invoiceNo: string; userId: string; subtotal: number; discount: number; total: number; amountPaid: number; paymentMethod: "CASH" | "CARD"; createdAt: Date }[] = [];
    const items: { pharmacyId: string; saleId: string; medicineId: string; batchId: string; quantity: number; unitPrice: number; costPrice: number; lineTotal: number }[] = [];
    let n = 0;
    for (let d = DAYS; d >= 1; d--) {
      for (let s = 0; s < SALES_PER_DAY; s++) {
        const id = randomUUID();
        const lines = 1 + Math.floor(rand() * 4);
        let subtotal = 0;
        for (let l = 0; l < lines; l++) {
          const k = Math.floor(rand() * count);
          const qty = 1 + Math.floor(rand() * 3);
          subtotal += qty * meds[k].salePrice;
          items.push({ pharmacyId, saleId: id, medicineId: meds[k].id, batchId: batches[k].id, quantity: qty, unitPrice: meds[k].salePrice, costPrice: meds[k].purchasePrice, lineTotal: qty * meds[k].salePrice });
        }
        const at = new Date(Date.now() - d * 86_400_000 + (8 + s / 4) * 3_600_000);
        sales.push({ id, pharmacyId, invoiceNo: `HIST-${++n}`, userId: admin.id, subtotal, discount: 0, total: subtotal, amountPaid: subtotal, paymentMethod: rand() < 0.8 ? "CASH" : "CARD", createdAt: at });
      }
    }
    await chunks(sales, (part) => db.sale.createMany({ data: part }));
    await chunks(items, (part) => db.saleItem.createMany({ data: part }));
    out.push({ slug, username: "admin", medicines: count });
  }
  await db.$executeRawUnsafe("ANALYZE");
  await db.$disconnect();
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
