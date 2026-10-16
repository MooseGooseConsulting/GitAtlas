ALTER TABLE "Project"
ADD COLUMN "inventoryStatus" TEXT NOT NULL DEFAULT 'unverified',
ADD COLUMN "inventoryFetchedAt" TIMESTAMP(3),
ADD COLUMN "inventoryLastSuccessAt" TIMESTAMP(3);