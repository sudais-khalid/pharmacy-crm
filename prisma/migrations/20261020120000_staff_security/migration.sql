-- Staff two-factor sign-in (task 3.4), the pharmacy setting that requires it, and notifications (task 3.5,
-- data model section 5).

-- AlterTable
ALTER TABLE "PharmacySettings" ADD COLUMN     "requireStaffTotp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" BIGINT,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "audiencePermission" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL DEFAULT current_setting('app.pharmacy_id'::text, true),
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "Notification_pharmacyId_createdAt_idx" ON "Notification"("pharmacyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_pharmacyId_dedupeKey_key" ON "Notification"("pharmacyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationRead_pharmacyId_idx" ON "NotificationRead"("pharmacyId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: notifications belong to one pharmacy
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Notification"
  USING ("pharmacyId" = current_setting('app.pharmacy_id', true))
  WITH CHECK ("pharmacyId" = current_setting('app.pharmacy_id', true));
ALTER TABLE "NotificationRead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NotificationRead"
  USING ("pharmacyId" = current_setting('app.pharmacy_id', true))
  WITH CHECK ("pharmacyId" = current_setting('app.pharmacy_id', true));
