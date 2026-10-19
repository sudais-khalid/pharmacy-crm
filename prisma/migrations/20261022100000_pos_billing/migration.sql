-- POS and billing (roadmap Phase 5): cash sessions, customer returns, walk-in details and receipt settings.

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('PAY_IN', 'PAY_OUT');

-- AlterEnum
ALTER TYPE "LedgerKind" ADD VALUE 'RETURN';

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'SALE_RETURN';
ALTER TYPE "MovementType" ADD VALUE 'SUPPLIER_RETURN';

-- AlterTable
ALTER TABLE "CustomerLedger" ADD COLUMN     "returnId" TEXT;

-- AlterTable
ALTER TABLE "PharmacySettings" ADD COLUMN     "autoPrintReceipt" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cashDiffThreshold" DECIMAL(12,2) NOT NULL DEFAULT 100,
ADD COLUMN     "receiptBatchLines" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiptFormat" TEXT NOT NULL DEFAULT 'THERMAL_80',
ADD COLUMN     "requireCashSession" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cashSessionId" TEXT,
ADD COLUMN     "cashTendered" DECIMAL(12,2),
ADD COLUMN     "changeGiven" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "receiptFormat" TEXT;

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "userId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingFloat" DECIMAL(12,2) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "expectedCash" DECIMAL(12,2),
    "countedCash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "note" TEXT,
    "closedById" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "sessionId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "number" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refundMethod" "PaymentMethod" NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "cashSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnItem" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "returnId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "costPrice" DECIMAL(12,4) NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SaleReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashSession_pharmacyId_openedAt_idx" ON "CashSession"("pharmacyId", "openedAt");

-- CreateIndex
CREATE INDEX "CashSession_userId_status_idx" ON "CashSession"("userId", "status");

-- CreateIndex
CREATE INDEX "CashMovement_sessionId_idx" ON "CashMovement"("sessionId");

-- CreateIndex
CREATE INDEX "SaleReturn_saleId_idx" ON "SaleReturn"("saleId");

-- CreateIndex
CREATE INDEX "SaleReturn_pharmacyId_createdAt_idx" ON "SaleReturn"("pharmacyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_pharmacyId_number_key" ON "SaleReturn"("pharmacyId", "number");

-- CreateIndex
CREATE INDEX "SaleReturnItem_returnId_idx" ON "SaleReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "SaleReturnItem_saleItemId_idx" ON "SaleReturnItem"("saleItemId");

-- CreateIndex
CREATE INDEX "Sale_cashSessionId_idx" ON "Sale"("cashSessionId");

-- CreateIndex
CREATE INDEX "Sale_pharmacyId_customerPhone_idx" ON "Sale"("pharmacyId", "customerPhone");

-- AddForeignKey
ALTER TABLE "CustomerLedger" ADD CONSTRAINT "CustomerLedger_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: one open drawer per cashier, sane amounts, and tenant isolation for the new tables
CREATE UNIQUE INDEX "CashSession_one_open_per_user" ON "CashSession"("userId") WHERE status = 'OPEN';
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_float_check" CHECK ("openingFloat" >= 0 AND ("countedCash" IS NULL OR "countedCash" >= 0));
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_amount_check" CHECK (amount > 0);
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_total_check" CHECK (total >= 0);
ALTER TABLE "SaleReturnItem" ADD CONSTRAINT "SaleReturnItem_quantity_check" CHECK (quantity > 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_change_check" CHECK ("changeGiven" >= 0);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CashSession','CashMovement','SaleReturn','SaleReturnItem'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("pharmacyId" = current_setting(''app.pharmacy_id'', true)) '
      'WITH CHECK ("pharmacyId" = current_setting(''app.pharmacy_id'', true))', t);
  END LOOP;
END
$$;

-- Custom roles that could see invoices keep seeing everyone's (the new sales.viewAll); templates are defined in code
UPDATE "Role" SET permissions = array_append(permissions, 'sales.viewAll')
WHERE NOT system AND 'sales.view' = ANY(permissions) AND NOT ('sales.viewAll' = ANY(permissions));
