-- Persisted rotation cursor so the semantic worker scans eligible projects
-- beyond a fixed first window across resumed ticks.
CREATE TABLE "SemanticWorkerState" (
    "id" TEXT NOT NULL,
    "cursorProjectId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SemanticWorkerState_pkey" PRIMARY KEY ("id")
);
