import { Prisma } from "@prisma/client";
import { route, AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { TZ, todayStr } from "@/lib/dates";
import { D } from "@/lib/money";

type Col = { key: string; label: string; format?: "money" | "int" | "date" | "text" | "percent" };
type Report = { title: string; description: string; columns: Col[]; rows: Record<string, unknown>[]; sumKeys?: string[] };

const REPORTS = ["sales", "profit", "purchases", "lowStock", "expired", "customerBalances", "supplierBalances"] as const;

export const GET = route("reports.view", async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") || "sales";
  if (!(REPORTS as readonly string[]).includes(type)) throw new AppError(400, "Unknown report type.");
  const today = todayStr();
  const from = sp.get("from") || today.slice(0, 8) + "01";
  const to = sp.get("to") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError(400, "Dates must be YYYY-MM-DD.");
  if (from > to) throw new AppError(400, "'From' date must not be after 'To' date.");
  const unit = sp.get("group") === "month" ? "month" : "day";
  const fmt = unit === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const fromD = from, toD = to;

  let r: Report;
  switch (type) {
    case "sales": {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(date_trunc(${unit}::text, s."createdAt" AT TIME ZONE ${TZ}), ${fmt}::text) AS period,
               COUNT(*)::int AS invoices, SUM(s.subtotal) AS subtotal, SUM(s.discount) AS discount, SUM(s.total) AS total,
               SUM(s."amountPaid") AS paid, SUM(s.total - s."amountPaid") AS credit
        FROM "Sale" s WHERE s.status='COMPLETED' AND (s."createdAt" AT TIME ZONE ${TZ})::date BETWEEN ${fromD}::date AND ${toD}::date
        GROUP BY 1 ORDER BY 1`;
      r = { title: `Sales (${unit === "month" ? "monthly" : "daily"})`, description: "Completed sales only. Cancelled invoices are excluded.", rows,
        columns: [{ key: "period", label: unit === "month" ? "Month" : "Date" }, { key: "invoices", label: "Invoices", format: "int" }, { key: "subtotal", label: "Subtotal", format: "money" }, { key: "discount", label: "Discount", format: "money" }, { key: "total", label: "Net sales", format: "money" }, { key: "paid", label: "Received", format: "money" }, { key: "credit", label: "On credit", format: "money" }],
        sumKeys: ["invoices", "subtotal", "discount", "total", "paid", "credit"] };
      break;
    }
    case "profit": {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(date_trunc(${unit}::text, s."createdAt" AT TIME ZONE ${TZ}), ${fmt}::text) AS period,
               SUM(s.total) AS revenue, COALESCE(SUM(c.cogs),0) AS cogs, SUM(s.total) - COALESCE(SUM(c.cogs),0) AS profit
        FROM "Sale" s
        LEFT JOIN (SELECT "saleId", SUM(quantity*"costPrice") AS cogs FROM "SaleItem" GROUP BY "saleId") c ON c."saleId" = s.id
        WHERE s.status='COMPLETED' AND (s."createdAt" AT TIME ZONE ${TZ})::date BETWEEN ${fromD}::date AND ${toD}::date
        GROUP BY 1 ORDER BY 1`;
      r = { title: `Profit (${unit === "month" ? "monthly" : "daily"})`, description: "Gross profit = net sales (after discounts) − cost of goods sold. Cost of goods sold uses the purchase price of the exact batches sold.", rows,
        columns: [{ key: "period", label: unit === "month" ? "Month" : "Date" }, { key: "revenue", label: "Net sales", format: "money" }, { key: "cogs", label: "Cost of goods", format: "money" }, { key: "profit", label: "Gross profit", format: "money" }],
        sumKeys: ["revenue", "cogs", "profit"] };
      break;
    }
    case "purchases": {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(date_trunc(${unit}::text, p."purchaseDate"), ${fmt}::text) AS period, COUNT(*)::int AS purchases,
               SUM(p.subtotal) AS subtotal, SUM(p.discount) AS discount, SUM(p.total) AS total, SUM(p.paid) AS paid, SUM(p.total - p.paid) AS due
        FROM "Purchase" p WHERE p."purchaseDate" BETWEEN ${fromD}::date AND ${toD}::date GROUP BY 1 ORDER BY 1`;
      r = { title: "Purchases", description: "Purchase invoices by purchase date.", rows,
        columns: [{ key: "period", label: unit === "month" ? "Month" : "Date" }, { key: "purchases", label: "Purchases", format: "int" }, { key: "subtotal", label: "Subtotal", format: "money" }, { key: "discount", label: "Discount", format: "money" }, { key: "total", label: "Total", format: "money" }, { key: "paid", label: "Paid", format: "money" }, { key: "due", label: "Unpaid", format: "money" }],
        sumKeys: ["purchases", "subtotal", "discount", "total", "paid", "due"] };
      break;
    }
    case "lowStock": {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT m.name AS medicine, COALESCE(c.name,'—') AS category, COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date),0)::int AS stock,
               m."minStock" AS "minStock", (m."minStock" - COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date),0))::int AS shortfall
        FROM "Medicine" m LEFT JOIN "Category" c ON c.id = m."categoryId" LEFT JOIN "Batch" b ON b."medicineId" = m.id
        WHERE m.active GROUP BY m.id, c.name
        HAVING COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date),0) <= m."minStock"
        ORDER BY stock ASC, m.name`;
      r = { title: "Low-stock medicines", description: "Active medicines whose sellable (non-expired) stock is at or below the minimum level.", rows,
        columns: [{ key: "medicine", label: "Medicine" }, { key: "category", label: "Category" }, { key: "stock", label: "In stock", format: "int" }, { key: "minStock", label: "Minimum", format: "int" }, { key: "shortfall", label: "Shortfall", format: "int" }] };
      break;
    }
    case "expired": {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT m.name AS medicine, b."batchNumber" AS batch, to_char(b."expiryDate",'YYYY-MM-DD') AS expiry, b.quantity::int AS quantity,
               b.quantity*b."purchasePrice" AS "costValue", b.quantity*b."salePrice" AS "retailValue"
        FROM "Batch" b JOIN "Medicine" m ON m.id = b."medicineId"
        WHERE b.quantity > 0 AND b."expiryDate" < ${today}::date ORDER BY b."expiryDate"`;
      r = { title: "Expired medicines", description: "Batches past their expiry date that still hold stock. These cannot be sold; remove them with a stock adjustment (Expired).", rows,
        columns: [{ key: "medicine", label: "Medicine" }, { key: "batch", label: "Batch" }, { key: "expiry", label: "Expired on", format: "date" }, { key: "quantity", label: "Qty", format: "int" }, { key: "costValue", label: "Cost value", format: "money" }, { key: "retailValue", label: "Retail value", format: "money" }],
        sumKeys: ["quantity", "costValue", "retailValue"] };
      break;
    }
    case "customerBalances": {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.name AS customer, COALESCE(c.phone,'') AS phone, c."creditLimit" AS "creditLimit", SUM(l.debit - l.credit) AS balance
        FROM "Customer" c JOIN "CustomerLedger" l ON l."customerId" = c.id GROUP BY c.id HAVING SUM(l.debit - l.credit) <> 0 ORDER BY balance DESC`;
      r = { title: "Customer balances (udhaar)", description: "Customers with a non-zero ledger balance. Positive = customer owes the pharmacy.", rows,
        columns: [{ key: "customer", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "creditLimit", label: "Credit limit", format: "money" }, { key: "balance", label: "Balance", format: "money" }], sumKeys: ["balance"] };
      break;
    }
    default: {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.name AS supplier, COALESCE(s.phone,'') AS phone, SUM(l.debit - l.credit) AS balance
        FROM "Supplier" s JOIN "SupplierLedger" l ON l."supplierId" = s.id GROUP BY s.id HAVING SUM(l.debit - l.credit) <> 0 ORDER BY balance DESC`;
      r = { title: "Supplier payables", description: "Amount the pharmacy owes each supplier.", rows,
        columns: [{ key: "supplier", label: "Supplier" }, { key: "phone", label: "Phone" }, { key: "balance", label: "Payable", format: "money" }], sumKeys: ["balance"] };
    }
  }

  let totals: Record<string, string> | null = null;
  if (r.sumKeys && r.rows.length) {
    totals = {};
    for (const k of r.sumKeys) totals[k] = r.rows.reduce<Prisma.Decimal>((s, row) => s.plus(D((row[k] as Prisma.Decimal.Value) ?? 0)), D(0)).toString();
  }
  return { type, from, to, title: r.title, description: r.description, columns: r.columns, rows: r.rows, totals };
});

export const dynamic = "force-dynamic";
