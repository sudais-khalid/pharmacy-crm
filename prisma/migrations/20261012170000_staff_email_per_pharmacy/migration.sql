-- DropIndex
DROP INDEX "User_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_pharmacyId_email_key" ON "User"("pharmacyId", "email");

