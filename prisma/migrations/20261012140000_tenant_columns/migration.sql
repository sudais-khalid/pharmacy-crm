-- Hand-written (Prisma's generated version cannot add NOT NULL columns to existing rows).
-- Turns the single-shop database into a multi-tenant one:
--   1. the existing shop becomes pharmacy "main" (only when the database already holds data),
--   2. every business table gets "pharmacyId", backfilled, then NOT NULL with a default taken from the
--      transaction's tenant setting (app.pharmacy_id), so application inserts never pass it by hand,
--   3. unique keys become per pharmacy, Setting moves into Pharmacy and PharmacySettings,
--   4. invoice and purchase numbering moves from global sequences to TenantCounter, continuing the series.
-- The end state matches schema.prisma exactly (checked by `npm run db:check`).

-- 1. The existing shop -------------------------------------------------------------------------------
CREATE TEMP TABLE _migrated_pharmacy (id text) ON COMMIT DROP;

DO $$
DECLARE
  pid text := gen_random_uuid()::text;
  has_data boolean := EXISTS (SELECT 1 FROM "User") OR EXISTS (SELECT 1 FROM "Setting") OR EXISTS (SELECT 1 FROM "Medicine");
BEGIN
  IF has_data THEN
    INSERT INTO "Pharmacy" (id, slug, name, address, phone, email, currency, "updatedAt")
    SELECT pid, 'main', COALESCE(NULLIF(s."pharmacyName", ''), 'My Pharmacy'), COALESCE(s.address, ''), COALESCE(s.phone, ''),
           NULLIF(s.email, ''), COALESCE(NULLIF(s.currency, ''), 'PKR'), CURRENT_TIMESTAMP
    FROM (SELECT 1) one LEFT JOIN "Setting" s ON s.id = 1;
    INSERT INTO "PharmacySettings" ("pharmacyId", "invoiceFooter", "expiryWarningDays", "updatedAt")
    SELECT pid, COALESCE(s."invoiceFooter", 'Thank you for your purchase. Get well soon!'), COALESCE(s."expiryWarningDays", 90), CURRENT_TIMESTAMP
    FROM (SELECT 1) one LEFT JOIN "Setting" s ON s.id = 1;
    INSERT INTO _migrated_pharmacy VALUES (pid);
  END IF;
END
$$;

-- 2. Tenant column on every business table ------------------------------------------------------------
ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_update_delete;

DO $$
DECLARE
  t text;
  pid text := (SELECT id FROM _migrated_pharmacy LIMIT 1);
BEGIN
  FOREACH t IN ARRAY ARRAY['User','Category','Medicine','Batch','StockMovement','Customer','CustomerLedger','Supplier',
                           'SupplierLedger','Purchase','PurchaseItem','Sale','SaleItem','AuditLog','OutboxEvent'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "pharmacyId" TEXT', t);
    IF pid IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET "pharmacyId" = %L', t, pid);
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "pharmacyId" SET DEFAULT current_setting(''app.pharmacy_id''::text, true)', t);
    IF t NOT IN ('AuditLog', 'OutboxEvent') THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN "pharmacyId" SET NOT NULL', t);
    END IF;
  END LOOP;
END
$$;

ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_update_delete;

-- 3. Staff accounts: per-pharmacy username and session controls --------------------------------------
ALTER TABLE "User" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "username" TEXT;

-- username = local part of the email, lower case, letters, digits, dot, dash, underscore; numbered on clashes
UPDATE "User" u SET username = x.username
FROM (
  SELECT id,
         base || CASE WHEN rn > 1 THEN rn::text ELSE '' END AS username
  FROM (
    SELECT id,
           COALESCE(NULLIF(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g'), ''), 'user') AS base,
           row_number() OVER (PARTITION BY "pharmacyId", COALESCE(NULLIF(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g'), ''), 'user') ORDER BY "createdAt", id) AS rn
    FROM "User"
  ) b
) x
WHERE u.id = x.id;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- 4. Settings move to Pharmacy and PharmacySettings ---------------------------------------------------
DROP TABLE "Setting";

-- 5. Numbering continues per pharmacy ----------------------------------------------------------------
DO $$
DECLARE
  pid text := (SELECT id FROM _migrated_pharmacy LIMIT 1);
  inv bigint;
  pur bigint;
BEGIN
  IF pid IS NOT NULL THEN
    SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO inv FROM invoice_seq;
    SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO pur FROM purchase_seq;
    INSERT INTO "TenantCounter" ("pharmacyId", key, value) VALUES (pid, 'INVOICE', inv), (pid, 'PURCHASE', pur);
  END IF;
END
$$;

DROP SEQUENCE invoice_seq;
DROP SEQUENCE purchase_seq;

-- 6. Indexes and unique keys become per pharmacy -----------------------------------------------------
DROP INDEX "AuditLog_at_idx";
DROP INDEX "Batch_expiryDate_idx";
DROP INDEX "Category_name_key";
DROP INDEX "Customer_name_idx";
DROP INDEX "Medicine_barcode_key";
DROP INDEX "Medicine_name_idx";
DROP INDEX "Medicine_sku_key";
DROP INDEX "Purchase_number_key";
DROP INDEX "Purchase_purchaseDate_idx";
DROP INDEX "Sale_createdAt_idx";
DROP INDEX "Sale_invoiceNo_key";
DROP INDEX "StockMovement_createdAt_idx";
DROP INDEX "Supplier_name_idx";

CREATE INDEX "AuditLog_pharmacyId_at_idx" ON "AuditLog"("pharmacyId", "at");
CREATE INDEX "Batch_pharmacyId_expiryDate_idx" ON "Batch"("pharmacyId", "expiryDate");
CREATE UNIQUE INDEX "Category_pharmacyId_name_key" ON "Category"("pharmacyId", "name");
CREATE INDEX "Customer_pharmacyId_name_idx" ON "Customer"("pharmacyId", "name");
CREATE INDEX "CustomerLedger_pharmacyId_idx" ON "CustomerLedger"("pharmacyId");
CREATE INDEX "Medicine_pharmacyId_name_idx" ON "Medicine"("pharmacyId", "name");
CREATE UNIQUE INDEX "Medicine_pharmacyId_barcode_key" ON "Medicine"("pharmacyId", "barcode");
CREATE UNIQUE INDEX "Medicine_pharmacyId_sku_key" ON "Medicine"("pharmacyId", "sku");
CREATE INDEX "OutboxEvent_pharmacyId_idx" ON "OutboxEvent"("pharmacyId");
CREATE INDEX "Purchase_pharmacyId_purchaseDate_idx" ON "Purchase"("pharmacyId", "purchaseDate");
CREATE UNIQUE INDEX "Purchase_pharmacyId_number_key" ON "Purchase"("pharmacyId", "number");
CREATE INDEX "PurchaseItem_pharmacyId_idx" ON "PurchaseItem"("pharmacyId");
CREATE INDEX "Sale_pharmacyId_createdAt_idx" ON "Sale"("pharmacyId", "createdAt");
CREATE UNIQUE INDEX "Sale_pharmacyId_invoiceNo_key" ON "Sale"("pharmacyId", "invoiceNo");
CREATE INDEX "SaleItem_pharmacyId_idx" ON "SaleItem"("pharmacyId");
CREATE INDEX "StockMovement_pharmacyId_createdAt_idx" ON "StockMovement"("pharmacyId", "createdAt");
CREATE INDEX "Supplier_pharmacyId_name_idx" ON "Supplier"("pharmacyId", "name");
CREATE INDEX "SupplierLedger_pharmacyId_idx" ON "SupplierLedger"("pharmacyId");
CREATE INDEX "User_pharmacyId_idx" ON "User"("pharmacyId");
CREATE UNIQUE INDEX "User_pharmacyId_username_key" ON "User"("pharmacyId", "username");

-- 7. Foreign keys to Pharmacy ------------------------------------------------------------------------
ALTER TABLE "User" ADD CONSTRAINT "User_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerLedger" ADD CONSTRAINT "CustomerLedger_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierLedger" ADD CONSTRAINT "SupplierLedger_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
