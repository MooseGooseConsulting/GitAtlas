CREATE TABLE "WorkResource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "issueNumber" INTEGER,
    "title" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceState" TEXT NOT NULL,
    "refName" TEXT,
    "createdAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceClosedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkResource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkResource_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkResource_projectId_sourceType_externalId_key"
  ON "WorkResource"("projectId", "sourceType", "externalId");
CREATE INDEX "WorkResource_projectId_sourceType_sourceUpdatedAt_idx"
  ON "WorkResource"("projectId", "sourceType", "sourceUpdatedAt");

CREATE TABLE "WorkReference" (
    "id" TEXT NOT NULL,
    "sourceResourceId" TEXT NOT NULL,
    "targetResourceId" TEXT,
    "targetExternalId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkReference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkReference_sourceResourceId_fkey"
      FOREIGN KEY ("sourceResourceId") REFERENCES "WorkResource"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkReference_targetResourceId_fkey"
      FOREIGN KEY ("targetResourceId") REFERENCES "WorkResource"("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkReference_sourceResourceId_targetExternalId_relationshipType_key"
  ON "WorkReference"("sourceResourceId", "targetExternalId", "relationshipType");
CREATE INDEX "WorkReference_targetResourceId_idx"
  ON "WorkReference"("targetResourceId");