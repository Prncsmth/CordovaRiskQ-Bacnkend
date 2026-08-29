-- CreateTable
CREATE TABLE "TideStatus" (
    "id" TEXT NOT NULL,
    "seaLevelM" DOUBLE PRECISION NOT NULL,
    "nextExtremeAt" TIMESTAMP(3),
    "nextExtremeType" TEXT,
    "floodRiskLevel" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TideStatus_pkey" PRIMARY KEY ("id")
);
