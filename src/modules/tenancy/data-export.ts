import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { to as copyTo } from "pg-copy-streams";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { AppError } from "@/lib/errors";
import { todayStr } from "@/lib/dates";

/**
 * A pharmacy's own data as a ZIP (roadmap 9.4; architecture, section 5: a pharmacy that leaves keeps its
 * data). One CSV per table with every row of that pharmacy, plus summary.xlsx with the lists people open
 * first (medicines with stock, customers and suppliers with balances), and a README. Passwords, sign-in
 * secrets, tokens and platform bookkeeping are left out; stored photos are listed but not included.
 */
const SKIP_TABLES = new Set(["AuthToken", "OutboxEvent", "SupportSession", "Notification", "NotificationRead", "TenantCounter", "FeatureFlag", "DailySummary"]);
const SKIP_COLUMNS: Record<string, Set<string>> = {
  User: new Set(["passwordHash", "recoveryCodes", "totpSecret", "sessionVersion"]),
  StoredFile: new Set(["data"]),
};
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const fileName = (table: string) => table.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

async function csvOf(client: Client, sql: string) {
  const chunks: Buffer[] = [];
  await pipeline(client.query(copyTo(sql)), new Writable({ write(chunk, _enc, done) { chunks.push(chunk); done(); } }));
  return Buffer.concat(chunks);
}

export async function exportPharmacyData(pharmacyId: string, connectionString = process.env.DATABASE_URL!) {
  // COPY takes no parameters: the id is checked and quoted instead
  if (!/^[0-9A-Za-z-]{1,64}$/.test(pharmacyId)) throw new AppError(404, "Pharmacy not found.");
  const id = `'${pharmacyId}'`;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const shop = (await client.query(`SELECT name, slug, currency FROM "Pharmacy" WHERE id = $1`, [pharmacyId])).rows[0] as { name: string; slug: string; currency: string } | undefined;
    if (!shop) throw new AppError(404, "Pharmacy not found.");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); // one consistent snapshot
    const tables = (await client.query(`
      SELECT c.table_name AS name, array_agg(c.column_name::text ORDER BY c.ordinal_position) AS columns
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'pharmacyId')
      GROUP BY c.table_name ORDER BY c.table_name`)).rows as { name: string; columns: string[] }[];
    const zip = new JSZip();
    const counts: string[] = [];
    for (const t of tables) {
      if (SKIP_TABLES.has(t.name)) continue;
      const cols = t.columns.filter((c) => c !== "pharmacyId" && !SKIP_COLUMNS[t.name]?.has(c));
      const order = cols.includes("createdAt") ? ` ORDER BY ${q("createdAt")}` : cols.includes("id") ? ` ORDER BY ${q("id")}` : "";
      const csv = await csvOf(client, `COPY (SELECT ${cols.map(q).join(", ")} FROM ${q(t.name)} WHERE ${q("pharmacyId")} = ${id}${order}) TO STDOUT WITH (FORMAT csv, HEADER true)`);
      zip.file(`csv/${fileName(t.name)}.csv`, csv);
      const rows = (await client.query(`SELECT count(*)::int AS n FROM ${q(t.name)} WHERE ${q("pharmacyId")} = $1`, [pharmacyId])).rows[0].n;
      counts.push(`  csv/${fileName(t.name)}.csv: ${rows} rows`);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = shop.name;
    const sheet = (title: string, columns: { header: string; key: string; width: number; money?: boolean }[], rows: Record<string, unknown>[]) => {
      const ws = wb.addWorksheet(title);
      ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: `"${shop.currency} "#,##0.00` } : {} }));
      ws.getRow(1).font = { bold: true };
      for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.money || typeof r[c.key] === "number" ? Number(r[c.key] ?? 0) : r[c.key]])));
    };
    const medicines = (await client.query(`
      SELECT m.name, m."genericName", c.name AS category, m.barcode, m."salePrice", m."minStock", COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= $2::date), 0)::int AS stock,
             MIN(b."expiryDate") FILTER (WHERE b.quantity > 0 AND b."expiryDate" >= $2::date)::text AS "nextExpiry", m.active
      FROM "Medicine" m LEFT JOIN "Category" c ON c.id = m."categoryId" LEFT JOIN "Batch" b ON b."medicineId" = m.id
      WHERE m."pharmacyId" = $1 GROUP BY m.id, c.name ORDER BY m.name`, [pharmacyId, todayStr()])).rows;
    sheet("Medicines", [{ header: "Name", key: "name", width: 32 }, { header: "Generic", key: "genericName", width: 24 }, { header: "Category", key: "category", width: 18 }, { header: "Barcode", key: "barcode", width: 16 }, { header: "Sale price", key: "salePrice", width: 14, money: true }, { header: "In stock", key: "stock", width: 10 }, { header: "Minimum", key: "minStock", width: 10 }, { header: "Next expiry", key: "nextExpiry", width: 12 }, { header: "Active", key: "active", width: 8 }], medicines);
    const customers = (await client.query(`
      SELECT c.name, c.phone, c."creditLimit", COALESCE(SUM(l.debit - l.credit), 0) AS balance, c.active
      FROM "Customer" c LEFT JOIN "CustomerLedger" l ON l."customerId" = c.id WHERE c."pharmacyId" = $1 GROUP BY c.id ORDER BY c.name`, [pharmacyId])).rows;
    sheet("Customers", [{ header: "Name", key: "name", width: 28 }, { header: "Phone", key: "phone", width: 16 }, { header: "Credit limit", key: "creditLimit", width: 14, money: true }, { header: "Owes", key: "balance", width: 14, money: true }, { header: "Active", key: "active", width: 8 }], customers);
    const suppliers = (await client.query(`
      SELECT s.name, s.phone, COALESCE(SUM(l.debit - l.credit), 0) AS balance, s.active
      FROM "Supplier" s LEFT JOIN "SupplierLedger" l ON l."supplierId" = s.id WHERE s."pharmacyId" = $1 GROUP BY s.id ORDER BY s.name`, [pharmacyId])).rows;
    sheet("Suppliers", [{ header: "Name", key: "name", width: 28 }, { header: "Phone", key: "phone", width: 16 }, { header: "Owed to them", key: "balance", width: 14, money: true }, { header: "Active", key: "active", width: 8 }], suppliers);
    await client.query("COMMIT");
    zip.file("summary.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));

    const at = new Date().toISOString();
    zip.file("README.txt", [
      `Data of ${shop.name} (code ${shop.slug}), exported ${at}.`, "",
      "summary.xlsx: medicines with stock, customers and suppliers with their balances.",
      "csv/: every record of the pharmacy, one file per table, in UTF-8 with a header row.",
      "Ids link the files to each other (for example sale-item.csv saleId to sale.csv id). Amounts are in " + shop.currency + ".",
      "Passwords and sign-in secrets are not included. Photos of bills and receipts are listed in stored-file.csv but not included.", "",
      ...counts, "",
    ].join("\r\n"));
    return { file: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }), name: `${shop.slug}-data-${at.slice(0, 10)}.zip`, pharmacyName: shop.name };
  } finally {
    await client.end();
  }
}

export function zipResponse(r: { file: Buffer; name: string }) {
  return new Response(new Uint8Array(r.file), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${r.name}"`, "cache-control": "no-store" },
  });
}
