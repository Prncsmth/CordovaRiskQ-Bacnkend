-- AlterTable
ALTER TABLE "User" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "longitude" DOUBLE PRECISION;
