# PostgreSQL migration handoff

- Prisma now uses PostgreSQL. `resolveDatabaseUrl()` prefers
  `GITATLAS_DATABASE_URL`, honors a PostgreSQL `DATABASE_URL`, maps the old
  development-only SQLite `.env` value to the local `gitatlas_dev` Unix socket,
  and rejects SQLite configuration in production.
- Apply migrations with `bun run db:migrate`; import the read-only legacy
  `db/custom.db` with `bun run db:import-sqlite`. `LEGACY_SQLITE_PATH` can
  override the source path. Import preserves IDs and every field in all four
  current Prisma models, verifies inserted rows, and refuses mismatched
  duplicate IDs/natural keys rather than overwriting data.
- `bun scripts/test-postgres-migration-isolated.ts` checks initial/duplicate
  import behavior, counts after opening a fresh Prisma client, and app Prisma
  create/read/update/delete in a transaction. The check reports aggregate
  counts only. (The `db:test-migration` package.json shortcut is wired in
  runtime PR #42, so run the script directly on this branch.)
- Local imported counts in `gitatlas_dev`: Project 29, AnalysisJob 3,
  CommitActivityCache 1, RecentCommitsCache 0. The SQLite database remains
  tracked and unchanged.
- The existing `gitatlas_dev` schema was baselined with
  `prisma migrate resolve --applied 20260930000000_postgresql_baseline` after
  `migrate deploy` found the already-created schema without migration history.
  Subsequent `migrate deploy` reruns report no pending migrations. A new
  process-unique isolated schema was also migrated twice and passed the import
  and Prisma smoke checks, then was dropped.
- `.zscripts/build.sh` no longer copies the SQLite database into packages;
  `.zscripts/start.sh` requires a PostgreSQL URL in production.
- Divergent same-ID rows no longer abort the import (fixed in `ef87652`).
  `importTable` (`scripts/import-sqlite.ts:143-155`) looks up the existing row
  by id, and when it exists it skips it, counting `divergent` via
  `assertSameLegacyRecord` (`:82-104`, returns a boolean). A hard failure is
  reserved for a genuine identity conflict: a natural key already held by a
  *different* id (`:130-141`). So the 13/29 refreshed legacy `Project` rows in
  live `gitatlas_dev` (2026-09-30) are now skipped and reported instead of
  making the command exit 1. The row is never overwritten or restored from
  SQLite.
- Post-insert verification throws on mismatch: the loop at
  `scripts/import-sqlite.ts:157-164` calls `assertSameLegacyRecord` for each
  inserted row and throws when it returns false, so a freshly inserted row
  whose stored fields differ is reported.
- `bun scripts/test-postgres-migration-isolated.ts` runs the automated
  isolated wrapper (`scripts/test-postgres-migration-isolated.ts`), which
  creates a process-unique `gitatlas_verify_<uuid>` schema in the configured
  database, applies migrations twice, runs `scripts/test-postgres-migration.ts`
  (identical rerun, changed same-ID preserved, different-ID conflict rejected,
  natural-key rollback, Prisma CRUD), and drops the schema on success or
  failure. It needs CREATE/DROP SCHEMA privilege on the configured database;
  it never writes the live schema. The older manual create/migrate/import/drop
  recipe is superseded by this wrapper. (The `db:test-migration` package.json
  shortcut is wired in runtime PR #42; use the direct `bun scripts/...`
  command on this branch.)
- Still relevant for direct runs: the `?host=%2Frun%2Fpostgresql&schema=` URL
  form and setting `GITATLAS_DATABASE_URL` (not `DATABASE_URL`) are the
  non-obvious parts. `db:import-sqlite` targets the configured schema, so it
  inserts legacy-only rows when pointed at live `gitatlas_dev`.
- Direct Prisma CLI calls (`bunx prisma migrate status`) fail with P1012 because
  the tracked `.env` still holds the legacy `DATABASE_URL="file:./db/custom.db"`.
  Use the `bun run db:migrate` / `db:import-sqlite` wrappers,
  `bun scripts/test-postgres-migration-isolated.ts` for the isolated check
  (the `db:test-migration` shortcut lands in runtime PR #42),
  or set `GITATLAS_DATABASE_URL` explicitly.
