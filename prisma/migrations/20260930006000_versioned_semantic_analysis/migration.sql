CREATE TABLE "RepositoryAnalysis" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "analyzedSha" TEXT,
    "evidenceHash" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "ownerNotesJson" TEXT NOT NULL,
    "samplingBoundary" TEXT NOT NULL,
    "resultJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "retryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositoryAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnerNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "provenance" TEXT NOT NULL DEFAULT 'owner',
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepositoryAnalysis_projectId_inputHash_key"
ON "RepositoryAnalysis"("projectId", "inputHash");
CREATE INDEX "RepositoryAnalysis_projectId_status_createdAt_idx"
ON "RepositoryAnalysis"("projectId", "status", "createdAt");
CREATE INDEX "RepositoryAnalysis_status_retryAt_idx"
ON "RepositoryAnalysis"("status", "retryAt");
CREATE INDEX "OwnerNote_projectId_createdAt_idx"
ON "OwnerNote"("projectId", "createdAt");

ALTER TABLE "RepositoryAnalysis"
ADD CONSTRAINT "RepositoryAnalysis_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerNote"
ADD CONSTRAINT "OwnerNote_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;