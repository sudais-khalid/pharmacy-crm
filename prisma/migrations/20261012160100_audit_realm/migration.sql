-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "realm" "Realm" NOT NULL DEFAULT 'STAFF',
ADD COLUMN     "supportSessionId" TEXT;

