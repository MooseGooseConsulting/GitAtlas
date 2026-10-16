-- Follow-up for databases that applied the PostgreSQL baseline before
-- Project.githubId was widened to BIGINT. Editing the baseline does not
-- re-run on already-migrated databases, so alter the column retroactively.
-- Fresh installs already get BIGINT from the baseline; this is a no-op for them.
-- Existing INT columns convert implicitly (INT values always fit in BIGINT).
ALTER TABLE "Project" ALTER COLUMN "githubId" TYPE BIGINT;
