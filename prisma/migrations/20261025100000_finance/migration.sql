-- Finance and reports (roadmap Phase 8): expense categories, expenses and the daily summary.

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "number" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "description" TEXT NOT NULL,
    "receiptFileId" TEXT,
    "cashSessionId" TEXT,
    "userId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySummary" (
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "date" DATE NOT NULL,
    "grossSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discounts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "returns" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cogs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stockLosses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "purchases" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySummary_pkey" PRIMARY KEY ("pharmacyId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_pharmacyId_name_key" ON "ExpenseCategory"("pharmacyId", "name");

-- CreateIndex
CREATE INDEX "Expense_pharmacyId_date_idx" ON "Expense"("pharmacyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_pharmacyId_number_key" ON "Expense"("pharmacyId", "number");

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummary" ADD CONSTRAINT "DailySummary_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: positive expense amounts, card or cash only, and tenant isolation for the new tables
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_check" CHECK (amount > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_method_check" CHECK (method IN ('CASH', 'CARD'));

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ExpenseCategory','Expense','DailySummary'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("pharmacyId" = current_setting(''app.pharmacy_id'', true)) '
      'WITH CHECK ("pharmacyId" = current_setting(''app.pharmacy_id'', true))', t);
  END LOOP;
END
$$;
