import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";
import { todayStr } from "@/lib/dates";
import { localDate, localTime } from "@/lib/sql-dates";
import { compareWithPrevious, profitAndLoss } from "@/modules/finance";

/**
 * Report registry (roadmap 8.3): every report the Reports screen and the exports offer, each with its
 * columns, whether it needs a date range, who may see it, and how to compute it. Cost reports need
 * cost.view; elsewhere cost columns are removed for roles without it (by the route).
 */
export type Format = "money" | "int" | "date" | "text" | "percent";
export type Column = { key: string; label: string; format?: Format };
export type Params = { from: string; to: string; unit: "day" | "month"; pharmacyId: string };
export type Result = { description: string; columns: Column[]; rows: Record<string, unknown>[]; sumKeys?: string[]; comparison?: { label: string; current: number; previous: number; previousFrom: string; previousTo: string } | null };
export type ReportDef = {
  id: string; title: string; group: "Sales" | "Purchases" | "Money" | "Stock" | "People"; ranged: boolean; grouped?: boolean; costReport?: boolean;
  /** a permission needed besides reports.view (net profit and expenses need finance.view) */
  needs?: "finance.view";
  run: (tx: Tx, p: Params) => Promise<Result>;
};

const period = (p: Params, col: Prisma.Sql) => Prisma.sql`to_char(date_trunc(${p.unit}::text, ${localTime(col)}), ${p.unit === "month" ? "YYYY-MM" : "YYYY-MM-DD"}::text)`;
const inRange = (p: Params, col: Prisma.Sql) => Prisma.sql`${localDate(col)} BETWEEN ${p.from}::date AND ${p.to}::date`;
const periodCol = (p: Params): Column => ({ key: "period", label: p.unit === "month" ? "Month" : "Date" });
const s = Prisma.sql`s."createdAt"`;

export const REPORTS: ReportDef[] = [
  {
    id: "sales", title: "Sales", group: "Sales", ranged: true, grouped: true,
    async run(tx, p) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT ${period(p, s)} AS period, COUNT(*)::int AS invoices, SUM(s.subtotal) AS subtotal, SUM(s.discount) AS discount, SUM(s.total) AS total,
               SUM(s."amountPaid") AS paid, SUM(s.total - s."amountPaid") AS credit
        FROM "Sale" s WHERE s.status = 'COMPLETED' AND ${inRange(p, s)} GROUP BY 1 ORDER BY 1`;
      const cmp = await compareWithPrevious({ pharmacyId: p.pharmacyId, tx }, p.from, p.to);
      return {
        description: "Completed sales by day or month; cancelled invoices are left out. Net sales here are before customer returns (see Profit and loss).",
        columns: [periodCol(p), { key: "invoices", label: "Invoices", format: "int" }, { key: "subtotal", label: "Subtotal", format: "money" }, { key: "discount", label: "Discount", format: "money" }, { key: "total", label: "Net sales", format: "money" }, { key: "paid", label: "Received", format: "money" }, { key: "credit", label: "On credit", format: "money" }],
        rows, sumKeys: ["invoices", "subtotal", "discount", "total", "paid", "credit"],
        comparison: { label: "Net sales after returns", current: cmp.current.netSales, previous: cmp.previous.netSales, previousFrom: cmp.previousFrom, previousTo: cmp.previousTo },
      };
    },
  },
  {
    id: "salesByCashier", title: "Sales by cashier", group: "Sales", ranged: true,
    async run(tx, p) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT u.name AS cashier, COUNT(*)::int AS invoices, SUM(s.total) AS total, SUM(CASE WHEN s."paymentMethod" = 'CASH' THEN s."amountPaid" ELSE 0 END) AS cash,
               SUM(CASE WHEN s."paymentMethod" = 'CARD' THEN s.total ELSE 0 END) AS card, SUM(s.total - s."amountPaid") AS credit
        FROM "Sale" s JOIN "User" u ON u.id = s."userId" WHERE s.status = 'COMPLETED' AND ${inRange(p, s)} GROUP BY u.id, u.name ORDER BY total DESC`;
      return {
        description: "Completed sales per staff member who made them.",
        columns: [{ key: "cashier", label: "Cashier" }, { key: "invoices", label: "Invoices", format: "int" }, { key: "total", label: "Net sales", format: "money" }, { key: "cash", label: "Cash", format: "money" }, { key: "card", label: "Card", format: "money" }, { key: "credit", label: "On credit", format: "money" }],
        rows, sumKeys: ["invoices", "total", "cash", "card", "credit"],
      };
    },
  },
  {
    id: "salesByMethod", title: "Sales by payment method", group: "Sales", ranged: true, grouped: true,
    async run(tx, p) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT ${period(p, s)} AS period,
               SUM(CASE WHEN s."paymentMethod" = 'CASH' THEN s.total ELSE 0 END) AS cash, SUM(CASE WHEN s."paymentMethod" = 'CARD' THEN s.total ELSE 0 END) AS card,
               SUM(CASE WHEN s."paymentMethod" = 'CREDIT' THEN s.total ELSE 0 END) AS credit, SUM(s.total) AS total
        FROM "Sale" s WHERE s.status = 'COMPLETED' AND ${inRange(p, s)} GROUP BY 1 ORDER BY 1`;
      return {
        description: "Completed sales split by how the customer paid (a credit sale's down payment stays under credit).",
        columns: [periodCol(p), { key: "cash", label: "Cash", format: "money" }, { key: "card", label: "Card", format: "money" }, { key: "credit", label: "Credit", format: "money" }, { key: "total", label: "Total", format: "money" }],
        rows, sumKeys: ["cash", "card", "credit", "total"],
      };
    },
  },
  {
    id: "salesByCategory", title: "Sales by category", group: "Sales", ranged: true,
    async run(tx, p) {
      // each line's share of the invoice discount comes off its value
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT COALESCE(c.name, 'No category') AS category, SUM(i.quantity)::int AS units,
               SUM(i."lineTotal" * CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 1 END) AS total,
               SUM(i.quantity * i."costPrice") AS "costValue"
        FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId" JOIN "Medicine" m ON m.id = i."medicineId" LEFT JOIN "Category" c ON c.id = m."categoryId"
        WHERE s.status = 'COMPLETED' AND ${inRange(p, s)} GROUP BY 1 ORDER BY total DESC`;
      return {
        description: "Completed sales per medicine category, after each invoice's discount.",
        columns: [{ key: "category", label: "Category" }, { key: "units", label: "Units", format: "int" }, { key: "total", label: "Net sales", format: "money" }, { key: "costValue", label: "Cost", format: "money" }],
        rows, sumKeys: ["units", "total", "costValue"],
      };
    },
  },
  {
    id: "topMedicines", title: "Top medicines", group: "Sales", ranged: true,
    async run(tx, p) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT m.name AS medicine, SUM(i.quantity)::int AS units, SUM(i."lineTotal" * CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 1 END) AS total
        FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId" JOIN "Medicine" m ON m.id = i."medicineId"
        WHERE s.status = 'COMPLETED' AND ${inRange(p, s)} GROUP BY m.id, m.name ORDER BY total DESC LIMIT 50`;
      return { description: "The 50 medicines that brought in most, after invoice discounts.", columns: [{ key: "medicine", label: "Medicine" }, { key: "units", label: "Units", format: "int" }, { key: "total", label: "Net sales", format: "money" }], rows, sumKeys: ["units", "total"] };
    },
  },
  {
    id: "profit", title: "Gross profit", group: "Money", ranged: true, grouped: true, costReport: true,
    async run(tx, p) {
      const { rows } = await profitAndLoss({ pharmacyId: p.pharmacyId, tx }, p);
      return {
        description: "Net sales (after discounts and returns) less the cost of the exact batches sold.",
        columns: [periodCol(p), { key: "netSales", label: "Net sales", format: "money" }, { key: "cogs", label: "Cost of goods", format: "money" }, { key: "grossProfit", label: "Gross profit", format: "money" }],
        rows: rows.filter((r) => r.netSales || r.cogs), sumKeys: ["netSales", "cogs", "grossProfit"],
      };
    },
  },
  {
    id: "pnl", title: "Profit and loss", group: "Money", ranged: true, grouped: true, costReport: true, needs: "finance.view",
    async run(tx, p) {
      const { rows } = await profitAndLoss({ pharmacyId: p.pharmacyId, tx }, p);
      return {
        description: "Net profit: net sales less cost of goods, stock written off (damage, expiry) and expenses. Cancelled sales and expenses count nowhere.",
        columns: [periodCol(p), { key: "grossSales", label: "Sales", format: "money" }, { key: "discounts", label: "Discounts", format: "money" }, { key: "returns", label: "Returns", format: "money" }, { key: "netSales", label: "Net sales", format: "money" },
          { key: "cogs", label: "Cost of goods", format: "money" }, { key: "grossProfit", label: "Gross profit", format: "money" }, { key: "stockLosses", label: "Written off", format: "money" }, { key: "expenses", label: "Expenses", format: "money" }, { key: "netProfit", label: "Net profit", format: "money" }],
        rows: rows.filter((r) => r.grossSales || r.returns || r.cogs || r.stockLosses || r.expenses),
        sumKeys: ["grossSales", "discounts", "returns", "netSales", "cogs", "grossProfit", "stockLosses", "expenses", "netProfit"],
      };
    },
  },
  {
    id: "expenses", title: "Expenses by category", group: "Money", ranged: true, needs: "finance.view",
    async run(tx, p) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT c.name AS category, COUNT(*)::int AS entries, SUM(e.amount) AS amount
        FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
        WHERE e."cancelledAt" IS NULL AND e.date BETWEEN ${p.from}::date AND ${p.to}::date GROUP BY c.name ORDER BY amount DESC`;
      return { description: "Expenses recorded in the period; cancelled ones are left out.", columns: [{ key: "category", label: "Category" }, { key: "entries", label: "Entries", format: "int" }, { key: "amount", label: "Amount", format: "money" }], rows, sumKeys: ["entries", "amount"] };
    },
  },
  {
    id: "purchases", title: "Purchases", group: "Purchases", ranged: true, grouped: true,
    async run(tx, p) {
      const pd = Prisma.sql`p."purchaseDate"`;
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(date_trunc(${p.unit}::text, ${pd}), ${p.unit === "month" ? "YYYY-MM" : "YYYY-MM-DD"}::text) AS period, COUNT(*)::int AS purchases,
               SUM(p.subtotal) AS subtotal, SUM(p."taxTotal") AS tax, SUM(p.discount) AS discount, SUM(p.total) AS total, SUM(p.paid) AS paid, SUM(p.total - p.paid) AS due
        FROM "Purchase" p WHERE ${pd} BETWEEN ${p.from}::date AND ${p.to}::date GROUP BY 1 ORDER BY 1`;
      return {
        description: "Supplier bills by bill date: paid at the time and still owed.",
        columns: [periodCol(p), { key: "purchases", label: "Bills", format: "int" }, { key: "subtotal", label: "Goods", format: "money" }, { key: "tax", label: "Tax", format: "money" }, { key: "discount", label: "Discount", format: "money" }, { key: "total", label: "Total", format: "money" }, { key: "paid", label: "Paid", format: "money" }, { key: "due", label: "Unpaid", format: "money" }],
        rows, sumKeys: ["purchases", "subtotal", "tax", "discount", "total", "paid", "due"],
      };
    },
  },
  {
    id: "purchasesBySupplier", title: "Purchases by supplier", group: "Purchases", ranged: true,
    async run(tx, p) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT su.name AS supplier, COUNT(*)::int AS purchases, SUM(p.total) AS total, SUM(p.paid) AS paid, SUM(p.total - p.paid) AS due
        FROM "Purchase" p JOIN "Supplier" su ON su.id = p."supplierId" WHERE p."purchaseDate" BETWEEN ${p.from}::date AND ${p.to}::date
        GROUP BY su.id, su.name ORDER BY total DESC`;
      return { description: "Bills per supplier in the period, with what was paid on them at the time.", columns: [{ key: "supplier", label: "Supplier" }, { key: "purchases", label: "Bills", format: "int" }, { key: "total", label: "Total", format: "money" }, { key: "paid", label: "Paid", format: "money" }, { key: "due", label: "Unpaid", format: "money" }], rows, sumKeys: ["purchases", "total", "paid", "due"] };
    },
  },
  {
    id: "purchasesBySource", title: "Purchases by how they were entered", group: "Purchases", ranged: true,
    async run(tx, p) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT CASE WHEN i.source = 'OCR' THEN 'Photo of the bill' WHEN i.source = 'IMPORT' THEN 'File import' WHEN i.source = 'MANUAL' THEN 'Typed in stock entry' ELSE 'Purchase form' END AS source,
               COUNT(*)::int AS purchases, SUM(p.total) AS total
        FROM "Purchase" p LEFT JOIN "StockIntake" i ON i.id = p."intakeId" WHERE p."purchaseDate" BETWEEN ${p.from}::date AND ${p.to}::date
        GROUP BY 1 ORDER BY total DESC`;
      return { description: "How the period's supplier bills came in: photographed, imported or typed.", columns: [{ key: "source", label: "Entered as" }, { key: "purchases", label: "Bills", format: "int" }, { key: "total", label: "Total", format: "money" }], rows, sumKeys: ["purchases", "total"] };
    },
  },
  {
    id: "lowStock", title: "Low stock", group: "Stock", ranged: false,
    async run(tx) {
      const today = todayStr();
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT m.name AS medicine, COALESCE(c.name, '-') AS category, COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date AND b."setAsideAt" IS NULL), 0)::int AS stock,
               m."minStock" AS "minStock", (m."minStock" - COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date AND b."setAsideAt" IS NULL), 0))::int AS shortfall
        FROM "Medicine" m LEFT JOIN "Category" c ON c.id = m."categoryId" LEFT JOIN "Batch" b ON b."medicineId" = m.id
        WHERE m.active GROUP BY m.id, c.name
        HAVING COALESCE(SUM(b.quantity) FILTER (WHERE b."expiryDate" >= ${today}::date AND b."setAsideAt" IS NULL), 0) <= m."minStock"
        ORDER BY stock ASC, m.name`;
      return { description: "Active medicines whose sellable stock is at or below the minimum.", columns: [{ key: "medicine", label: "Medicine" }, { key: "category", label: "Category" }, { key: "stock", label: "In stock", format: "int" }, { key: "minStock", label: "Minimum", format: "int" }, { key: "shortfall", label: "Shortfall", format: "int" }], rows };
    },
  },
  {
    id: "expired", title: "Expired medicines", group: "Stock", ranged: false,
    async run(tx) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT m.name AS medicine, b."batchNumber" AS batch, to_char(b."expiryDate", 'YYYY-MM-DD') AS expiry, b.quantity::int AS quantity,
               b.quantity * b."purchasePrice" AS "costValue", b.quantity * b."salePrice" AS "retailValue"
        FROM "Batch" b JOIN "Medicine" m ON m.id = b."medicineId" WHERE b.quantity > 0 AND b."expiryDate" < ${todayStr()}::date ORDER BY b."expiryDate"`;
      return { description: "Batches past their expiry that still hold stock. Write them off or return them on Inventory, Expiry.", columns: [{ key: "medicine", label: "Medicine" }, { key: "batch", label: "Batch" }, { key: "expiry", label: "Expired on", format: "date" }, { key: "quantity", label: "Qty", format: "int" }, { key: "costValue", label: "Cost value", format: "money" }, { key: "retailValue", label: "Retail value", format: "money" }], rows, sumKeys: ["quantity", "costValue", "retailValue"] };
    },
  },
  {
    id: "customerBalances", title: "Customer balances", group: "People", ranged: false,
    async run(tx) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT c.name AS customer, COALESCE(c.phone, '') AS phone, c."creditLimit" AS "creditLimit", SUM(l.debit - l.credit) AS balance
        FROM "Customer" c JOIN "CustomerLedger" l ON l."customerId" = c.id GROUP BY c.id HAVING SUM(l.debit - l.credit) <> 0 ORDER BY balance DESC`;
      return { description: "Customers with a balance (udhaar). Positive: the customer owes the pharmacy.", columns: [{ key: "customer", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "creditLimit", label: "Credit limit", format: "money" }, { key: "balance", label: "Balance", format: "money" }], rows, sumKeys: ["balance"] };
    },
  },
  {
    id: "supplierBalances", title: "Supplier payables", group: "People", ranged: false,
    async run(tx) {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>`
        SELECT s.name AS supplier, COALESCE(s.phone, '') AS phone, SUM(l.debit - l.credit) AS balance
        FROM "Supplier" s JOIN "SupplierLedger" l ON l."supplierId" = s.id GROUP BY s.id HAVING SUM(l.debit - l.credit) <> 0 ORDER BY balance DESC`;
      return { description: "What the pharmacy owes each supplier, after payments and returns.", columns: [{ key: "supplier", label: "Supplier" }, { key: "phone", label: "Phone" }, { key: "balance", label: "Payable", format: "money" }], rows, sumKeys: ["balance"] };
    },
  },
];

export const reportById = (id: string) => REPORTS.find((r) => r.id === id) ?? null;
