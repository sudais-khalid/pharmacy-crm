-- AlterTable
-- when the Developer password was set, so a newer one carried by an update replaces it (desktop builds)
ALTER TABLE "PlatformUser" ADD COLUMN "passwordSetAt" TIMESTAMP(3);
