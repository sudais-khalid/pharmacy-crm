-- Branding (docs/plan/05-roadmap.md, task 3.6): colour, logo in two sizes, receipt header, and files kept in
-- the database (StoredFile) so backups, restores and row-level security cover them.

-- AlterTable
ALTER TABLE "Pharmacy" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "logoFileId" TEXT,
ADD COLUMN     "logoIconFileId" TEXT;

-- AlterTable
ALTER TABLE "PharmacySettings" ADD COLUMN     "receiptHeader" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "purpose" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoredFile_pharmacyId_sha256_idx" ON "StoredFile"("pharmacyId", "sha256");

-- AddForeignKey
ALTER TABLE "Pharmacy" ADD CONSTRAINT "Pharmacy_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pharmacy" ADD CONSTRAINT "Pharmacy_logoIconFileId_fkey" FOREIGN KEY ("logoIconFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: tenant isolation for files, and the branding columns a pharmacy may change itself
ALTER TABLE "StoredFile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StoredFile"
  USING ("pharmacyId" = current_setting('app.pharmacy_id', true))
  WITH CHECK ("pharmacyId" = current_setting('app.pharmacy_id', true));
GRANT UPDATE ("brandColor", "logoFileId", "logoIconFileId") ON "Pharmacy" TO pcrm_app;
