-- Stock intelligence (roadmap Phase 6): batches set aside for return to the supplier are not sold.

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "setAsideAt" TIMESTAMP(3),
ADD COLUMN     "setAsideNote" TEXT;

