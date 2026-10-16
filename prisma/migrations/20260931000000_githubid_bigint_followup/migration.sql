-- Follow-up for databases that applied the PostgreSQL baseline before
-- Project.githubId was widened to BIGINT. Editing the baseline does not
-- re-run on already-migrated databases, so alter the column retroactively.
-- Fresh installs already get BIGINT from the baseline; this is a no-op for them.
-- Existing INT columns convert implicitly (INT values always fit in BIGINT).
-- Maintenance window: on PostgreSQL 16 this ALTER COLUMN ... TYPE rewrite
-- takes an ACCESS EXCLUSIVE lock on "Project", blocking reads and writes
-- while the table is rewritten. Run during a maintenance window with
-- application traffic quiesced.
ALTER TABLE "Project" ALTER COLUMN "githubId" TYPE BIGINT;
