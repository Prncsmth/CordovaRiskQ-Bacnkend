/*
  Warnings:

  - Added the required column `airTemperatureC` to the `TideStatus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `weatherDescription` to the `TideStatus` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TideStatus" ADD COLUMN     "airTemperatureC" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "weatherDescription" TEXT NOT NULL;
