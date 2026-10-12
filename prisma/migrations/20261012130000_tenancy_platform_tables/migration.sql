-- CreateEnum
CREATE TYPE "PharmacyStatus" AS ENUM ('ACTIVE', 'GRACE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "Realm" AS ENUM ('PLATFORM', 'STAFF');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('INVITE', 'RESET');

-- CreateTable
CREATE TABLE "Pharmacy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT,
    "phone" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT,
    "email" TEXT,
    "licenseNumber" TEXT,
    "taxNumber" TEXT,
    "status" "PharmacyStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'STANDARD',
    "subscriptionEndsAt" TIMESTAMP(3),
    "maxUsers" INTEGER NOT NULL DEFAULT 10,
    "ocrMonthlyLimit" INTEGER NOT NULL DEFAULT 300,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pharmacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacySettings" (
    "pharmacyId" TEXT NOT NULL,
    "invoiceFooter" TEXT NOT NULL DEFAULT 'Thank you for your purchase. Get well soon!',
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 90,
    "expiryAlertDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacySettings_pkey" PRIMARY KEY ("pharmacyId")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "recoveryCodes" TEXT[],
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantCounter" (
    "pharmacyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "TenantCounter_pkey" PRIMARY KEY ("pharmacyId","key")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "realm" "Realm" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "pharmacyId" TEXT,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByRealm" "Realm" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "pharmacyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("pharmacyId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacy_slug_key" ON "Pharmacy"("slug");

-- CreateIndex
CREATE INDEX "Pharmacy_status_idx" ON "Pharmacy"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_subjectId_purpose_idx" ON "AuthToken"("subjectId", "purpose");

-- CreateIndex
CREATE INDEX "SupportSession_pharmacyId_startedAt_idx" ON "SupportSession"("pharmacyId", "startedAt");

-- AddForeignKey
ALTER TABLE "PharmacySettings" ADD CONSTRAINT "PharmacySettings_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantCounter" ADD CONSTRAINT "TenantCounter_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
