-- Stock entry (docs/plan/05-roadmap.md, tasks 4.1, 4.2, 4.10 and 4.12): purchase lines with bonus, discount,
-- tax and effective cost; stock entry drafts with pages and lines; supplier text aliases; OCR providers.

-- CreateEnum
CREATE TYPE "IntakeKind" AS ENUM ('PURCHASE_BILL', 'STOCK_LIST');

-- CreateEnum
CREATE TYPE "IntakeSource" AS ENUM ('MANUAL', 'OCR', 'IMPORT');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('DRAFT', 'UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'POSTED', 'FAILED', 'DISCARDED');

-- AlterTable
ALTER TABLE "Batch" ALTER COLUMN "purchasePrice" SET DATA TYPE DECIMAL(12,4);

-- AlterTable
ALTER TABLE "Pharmacy" ADD COLUMN     "ocrProviders" TEXT[] DEFAULT ARRAY['LOCAL']::TEXT[];

-- AlterTable
ALTER TABLE "PharmacySettings" ADD COLUMN     "ocrProvider" TEXT NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "intakeId" TEXT,
ADD COLUMN     "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN     "bonusQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "effectiveCost" DECIMAL(12,4),
ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ALTER COLUMN "costPrice" SET DATA TYPE DECIMAL(12,4);

-- CreateTable
CREATE TABLE "StockIntake" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "number" TEXT NOT NULL,
    "kind" "IntakeKind" NOT NULL,
    "source" "IntakeSource" NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierId" TEXT,
    "supplierInvoice" TEXT,
    "billDate" DATE,
    "billTotal" DECIMAL(12,2),
    "billDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "note" TEXT,
    "provider" TEXT,
    "rawResult" JSONB,
    "header" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockIntakePage" (
    "intakeId" TEXT NOT NULL,
    "pageNo" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),

    CONSTRAINT "StockIntakePage_pkey" PRIMARY KEY ("intakeId","pageNo")
);

-- CreateTable
CREATE TABLE "StockIntakeLine" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "intakeId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "rawText" TEXT,
    "name" TEXT,
    "medicineId" TEXT,
    "batchNumber" TEXT,
    "expiryDate" DATE,
    "quantity" INTEGER,
    "bonusQty" INTEGER,
    "rate" DECIMAL(12,2),
    "discountPercent" DECIMAL(5,2),
    "taxAmount" DECIMAL(12,2),
    "amount" DECIMAL(12,2),
    "salePrice" DECIMAL(12,2),
    "matchMethod" TEXT,
    "confidence" DOUBLE PRECISION,
    "boxes" JSONB,
    "ignored" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockIntakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItemAlias" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "supplierId" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierItemAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockIntake_pharmacyId_status_createdAt_idx" ON "StockIntake"("pharmacyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockIntake_pharmacyId_number_key" ON "StockIntake"("pharmacyId", "number");

-- CreateIndex
CREATE INDEX "StockIntakePage_pharmacyId_idx" ON "StockIntakePage"("pharmacyId");

-- CreateIndex
CREATE INDEX "StockIntakeLine_pharmacyId_idx" ON "StockIntakeLine"("pharmacyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockIntakeLine_intakeId_lineNo_key" ON "StockIntakeLine"("intakeId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierItemAlias_pharmacyId_supplierId_text_key" ON "SupplierItemAlias"("pharmacyId", "supplierId", "text");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_intakeId_key" ON "Purchase"("intakeId");

-- Hand-written: existing lines get their cost per unit (no bonus was recorded before)
UPDATE "PurchaseItem" SET "effectiveCost" = CASE WHEN "quantity" > 0 THEN round("lineTotal" / "quantity", 4) ELSE "purchasePrice" END;
ALTER TABLE "PurchaseItem" ALTER COLUMN "effectiveCost" SET NOT NULL;

-- Hand-written: a supplier invoice number entered twice before this check keeps its later copies apart
UPDATE "Purchase" p SET "supplierInvoice" = p."supplierInvoice" || ' (' || p."number" || ')'
WHERE p."supplierInvoice" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "Purchase" q
  WHERE q."pharmacyId" = p."pharmacyId" AND q."supplierId" = p."supplierId" AND q."supplierInvoice" = p."supplierInvoice" AND q."createdAt" < p."createdAt"
);

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_pharmacyId_supplierId_supplierInvoice_key" ON "Purchase"("pharmacyId", "supplierId", "supplierInvoice");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "StockIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntakePage" ADD CONSTRAINT "StockIntakePage_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "StockIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntakePage" ADD CONSTRAINT "StockIntakePage_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntakeLine" ADD CONSTRAINT "StockIntakeLine_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "StockIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntakeLine" ADD CONSTRAINT "StockIntakeLine_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntakeLine" ADD CONSTRAINT "StockIntakeLine_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItemAlias" ADD CONSTRAINT "SupplierItemAlias_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItemAlias" ADD CONSTRAINT "SupplierItemAlias_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: tenant isolation for the new tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['StockIntake','StockIntakePage','StockIntakeLine','SupplierItemAlias'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("pharmacyId" = current_setting(''app.pharmacy_id'', true)) '
      'WITH CHECK ("pharmacyId" = current_setting(''app.pharmacy_id'', true))', t);
  END LOOP;
END
$$;
