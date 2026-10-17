CREATE TABLE "EstateAnalysis" (
    "id" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "analysisVersionIds" TEXT NOT NULL,
    "coverageJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "retryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstateAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectEdge" (
    "id" TEXT NOT NULL,
    "sourceProjectId" TEXT NOT NULL,
    "targetProjectId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'heuristic_similarity',
    "relationshipType" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'exploratory',
    "evidenceJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEdge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EstateAnalysis_inputHash_key"
ON "EstateAnalysis"("inputHash");
CREATE INDEX "EstateAnalysis_status_retryAt_idx"
ON "EstateAnalysis"("status", "retryAt");
CREATE INDEX "EstateAnalysis_createdAt_idx"
ON "EstateAnalysis"("createdAt");

CREATE UNIQUE INDEX "ProjectEdge_sourceProjectId_targetProjectId_relationshipType_key"
ON "ProjectEdge"("sourceProjectId", "targetProjectId", "relationshipType");
CREATE INDEX "ProjectEdge_targetProjectId_idx"
ON "ProjectEdge"("targetProjectId");

ALTER TABLE "ProjectEdge"
ADD CONSTRAINT "ProjectEdge_sourceProjectId_fkey"
FOREIGN KEY ("sourceProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectEdge"
ADD CONSTRAINT "ProjectEdge_targetProjectId_fkey"
FOREIGN KEY ("targetProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Typed evidence categories for work references. Existing rows are backfilled
-- from their relationship type: explicit GitHub links are authoritative,
-- inferred mentions are source-supported inferences.
ALTER TABLE "WorkReference"
    ADD COLUMN "category" TEXT,
    ADD COLUMN "confidence" TEXT,
    ADD COLUMN "intent" TEXT NOT NULL DEFAULT 'reference';

UPDATE "WorkReference"
SET "category" = CASE
        WHEN "relationshipType" = 'explicit' THEN 'explicit_github_link'
        ELSE 'source_supported_inference'
    END,
    "confidence" = CASE
        WHEN "relationshipType" = 'explicit' THEN 'authoritative'
        ELSE 'supported'
    END;

ALTER TABLE "WorkReference"
    ALTER COLUMN "category" SET NOT NULL,
    ALTER COLUMN "category" SET DEFAULT 'explicit_github_link',
    ALTER COLUMN "confidence" SET NOT NULL,
    ALTER COLUMN "confidence" SET DEFAULT 'authoritative';
