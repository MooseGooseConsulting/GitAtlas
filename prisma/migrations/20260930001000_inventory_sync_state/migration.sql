ALTER TABLE "Project"
ADD COLUMN "defaultBranchHeadSha" TEXT;

CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "fetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncState_scope_key" ON "SyncState"("scope");