ALTER TABLE "WorkReference"
  ALTER COLUMN "targetUrl" DROP NOT NULL,
  ADD COLUMN "targetSourceType" TEXT;