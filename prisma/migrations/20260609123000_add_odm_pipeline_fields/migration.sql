ALTER TABLE "Scan"
ADD COLUMN "media" JSONB,
ADD COLUMN "preparedImages" JSONB,
ADD COLUMN "storagePath" TEXT,
ADD COLUMN "outputPath" TEXT,
ADD COLUMN "modelAssetUrl" TEXT,
ADD COLUMN "modelAssetType" TEXT,
ADD COLUMN "nodeOdmTaskId" TEXT,
ADD COLUMN "reconstructionEngine" TEXT,
ADD COLUMN "errorMessage" TEXT;

CREATE INDEX "Scan_nodeOdmTaskId_idx" ON "Scan"("nodeOdmTaskId");
