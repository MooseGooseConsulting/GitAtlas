-- Baseline PostgreSQL schema. The legacy SQLite database is imported separately
-- by scripts/import-sqlite.ts and is never modified by this migration.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "description" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "homepage" TEXT,
    "language" TEXT,
    "stargazersCount" INTEGER NOT NULL DEFAULT 0,
    "forksCount" INTEGER NOT NULL DEFAULT 0,
    "openIssuesCount" INTEGER NOT NULL DEFAULT 0,
    "githubCreatedAt" TIMESTAMP(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,
    "pushedAt" TIMESTAMP(3),
    "topics" TEXT NOT NULL DEFAULT '',
    "isFork" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "ownerLogin" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'User',
    "ownerAvatarUrl" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "summary" TEXT,
    "tags" TEXT,
    "category" TEXT,
    "readmeContent" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileTree" TEXT,
    "dependencies" TEXT,
    "keyFiles" TEXT,
    "deepSummary" TEXT,
    "deepAnalyzedAt" TIMESTAMP(3),
    "proposedReadme" TEXT,
    "readmeGeneratedAt" TIMESTAMP(3),
    "similarProjects" TEXT,
    "codeSignature" TEXT,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalRepos" INTEGER NOT NULL DEFAULT 0,
    "processedRepos" INTEGER NOT NULL DEFAULT 0,
    "jobType" TEXT NOT NULL DEFAULT 'shallow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommitActivityCache" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "activityJson" TEXT NOT NULL,
    "totalCommits" INTEGER NOT NULL DEFAULT 0,
    "activeDays" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommitActivityCache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecentCommitsCache" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "commitsJson" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecentCommitsCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Project_githubId_key" ON "Project"("githubId");
CREATE UNIQUE INDEX "CommitActivityCache_username_key" ON "CommitActivityCache"("username");
CREATE UNIQUE INDEX "RecentCommitsCache_username_key" ON "RecentCommitsCache"("username");