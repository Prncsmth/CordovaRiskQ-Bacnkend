-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'citizen';

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "sosAlertId" TEXT,
    "category" TEXT NOT NULL,
    "details" TEXT,
    "locationLabel" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "urgency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "acceptedByResponderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_acceptedByResponderId_fkey" FOREIGN KEY ("acceptedByResponderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
