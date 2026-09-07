-- DropForeignKey
ALTER TABLE "Incident" DROP CONSTRAINT "Incident_acceptedByResponderId_fkey";

-- AlterTable
ALTER TABLE "Incident" DROP COLUMN "acceptedByResponderId";
