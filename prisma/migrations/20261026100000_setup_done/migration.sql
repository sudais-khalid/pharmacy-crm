-- AlterTable
-- set once the Pharmacy Admin finishes or skips the first-run setup (roadmap 9.9); existing pharmacies count as set up
ALTER TABLE "PharmacySettings" ADD COLUMN     "setupDoneAt" TIMESTAMP(3);
UPDATE "PharmacySettings" SET "setupDoneAt" = CURRENT_TIMESTAMP;
