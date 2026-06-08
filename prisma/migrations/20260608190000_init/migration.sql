CREATE TYPE "ScanStatus" AS ENUM ('queued', 'processing', 'complete', 'failed');

CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 10,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "coverage" INTEGER NOT NULL DEFAULT 0,
    "captureMode" TEXT NOT NULL DEFAULT 'continuous-survey',
    "locationStatus" TEXT NOT NULL DEFAULT 'unknown',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "frames" JSONB NOT NULL,
    "coverageMap" JSONB,
    "summary" JSONB,
    "model" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Scan_status_idx" ON "Scan"("status");
CREATE INDEX "Scan_createdAt_idx" ON "Scan"("createdAt");
