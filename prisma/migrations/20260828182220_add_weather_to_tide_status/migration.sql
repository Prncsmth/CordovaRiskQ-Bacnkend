/*
  Warnings:

  - Added the required column `airTemperatureC` to the `TideStatus` table without a default value. This is not possible if the table is not empty.
  - Added the required column `weatherDescription` to the `TideStatus` table without a default value. This is not possible if the table is not empty.

*/
-- The TideStatus row is a regenerable cache (an hourly-ish Stormglass poll
-- result), not user data. Clear it before adding the new NOT NULL columns
-- so this migration applies cleanly on any database, instead of requiring
-- a fabricated default value. startTidePolling() repopulates the row in
-- full on the next server start.
DELETE FROM "TideStatus";

-- AlterTable
ALTER TABLE "TideStatus" ADD COLUMN     "airTemperatureC" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "weatherDescription" TEXT NOT NULL;
