-- Reorder suggestions: days of sales to keep on hand beyond the supplier lead time.

-- AlterTable
ALTER TABLE "PharmacySettings" ADD COLUMN     "reorderCoverDays" INTEGER NOT NULL DEFAULT 7;

