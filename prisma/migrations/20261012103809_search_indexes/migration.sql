-- Hand-written: pg_trgm powers case-insensitive "contains" search (ILIKE) through GIN indexes.
-- It is a trusted extension, so the database owner can create it without superuser rights.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Batch_batchNumber_trgm_idx" ON "Batch" USING GIN ("batchNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_phone_trgm_idx" ON "Customer" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Medicine_name_trgm_idx" ON "Medicine" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Medicine_genericName_trgm_idx" ON "Medicine" USING GIN ("genericName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Medicine_barcode_trgm_idx" ON "Medicine" USING GIN ("barcode" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Medicine_sku_trgm_idx" ON "Medicine" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Sale_invoiceNo_trgm_idx" ON "Sale" USING GIN ("invoiceNo" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Supplier_name_trgm_idx" ON "Supplier" USING GIN ("name" gin_trgm_ops);
