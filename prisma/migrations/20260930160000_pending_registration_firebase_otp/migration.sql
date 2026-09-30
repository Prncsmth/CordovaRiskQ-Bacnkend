-- AlterTable
ALTER TABLE "PendingRegistration" ADD COLUMN     "firebaseUid" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PendingRegistration_firebaseUid_key" ON "PendingRegistration"("firebaseUid");
