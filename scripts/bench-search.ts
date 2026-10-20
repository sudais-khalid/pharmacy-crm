/**
 * Benchmark for the Ctrl+K search (roadmap 6.7): 20,000 medicines in a throwaway pharmacy in the test
 * database, then partial generic names timed through the real search code. Fails above 150 ms (p95).
 *
 *   npx tsx scripts/bench-search.ts
 */
import { loadEnvConfig } from "@next/env";
(process.env as Record<string, string>).NODE_ENV = "test"; // loads .env.test
loadEnvConfig(process.cwd(), false);

const COUNT = 20_000;
const LIMIT_MS = 150;
const GENERICS = [
  "Paracetamol", "Amoxicillin", "Clavulanic acid", "Ibuprofen", "Metronidazole", "Omeprazole", "Esomeprazole", "Cetirizine", "Loratadine", "Metformin",
  "Glimepiride", "Atorvastatin", "Rosuvastatin", "Amlodipine", "Losartan", "Ciprofloxacin", "Levofloxacin", "Azithromycin", "Clarithromycin", "Cefixime",
  "Ceftriaxone", "Diclofenac", "Mefenamic acid", "Domperidone", "Ondansetron", "Salbutamol", "Montelukast", "Prednisolone", "Dexamethasone", "Fexofenadine",
  "Ranitidine", "Famotidine", "Pantoprazole", "Lansoprazole", "Tramadol", "Pregabalin", "Gabapentin", "Sertraline", "Escitalopram", "Alprazolam",
];
const FORMS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Cream"];
const QUERIES = ["amoxi", "cetiriz", "paracet", "omepra", "clavul", "glimep", "rosuva", "fexofen"];

async function main() {
  const { platformDb } = await import("../src/lib/platform-db");
  const { serviceContext, ALL_PERMISSIONS } = await import("../src/modules/identity");
  const { globalSearch } = await import("../src/modules/catalog");

  const slug = `bench-${Date.now().toString(36)}`;
  const pharmacy = await platformDb.pharmacy.create({ data: { slug, name: "Search benchmark", settings: { create: {} } } });
  try {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const rows = Array.from({ length: COUNT }, (_, i) => {
      const generic = GENERICS[Math.floor(rand() * GENERICS.length)];
      const brand = `Brand${i.toString(36)}`;
      return { pharmacyId: pharmacy.id, name: `${brand} ${Math.floor(rand() * 900) + 10}mg ${FORMS[i % FORMS.length]}`, genericName: generic, barcode: `BENCH${i}`, salePrice: 10, purchasePrice: 8 };
    });
    for (let i = 0; i < rows.length; i += 2000) await platformDb.medicine.createMany({ data: rows.slice(i, i + 2000) });
    await platformDb.$executeRawUnsafe(`ANALYZE "Medicine"`);

    const ctx = serviceContext({ id: "00000000-0000-4000-8000-000000000000", permissions: ALL_PERMISSIONS }, pharmacy.id);
    for (const q of QUERIES) await globalSearch(ctx, q); // warm up
    const times: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (const q of QUERIES) {
        const t0 = performance.now();
        const hits = await globalSearch(ctx, q);
        times.push(performance.now() - t0);
        if (round === 0 && !hits.some((h) => h.kind === "medicine")) throw new Error(`no medicine found for "${q}"`);
      }
    }
    times.sort((a, b) => a - b);
    const p = (x: number) => times[Math.min(times.length - 1, Math.floor(times.length * x))].toFixed(1);
    console.log(`${COUNT} medicines, ${times.length} searches: p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${times.at(-1)!.toFixed(1)} ms (limit ${LIMIT_MS} ms)`);
    if (Number(p(0.95)) > LIMIT_MS) process.exitCode = 1;
  } finally {
    await platformDb.medicine.deleteMany({ where: { pharmacyId: pharmacy.id } });
    await platformDb.pharmacySettings.deleteMany({ where: { pharmacyId: pharmacy.id } });
    await platformDb.pharmacy.delete({ where: { id: pharmacy.id } });
    await platformDb.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
