# PostgreSQL migration

GitAtlas uses Prisma with PostgreSQL. The checked-in `db/custom.db` remains a
read-only legacy source and is not a runtime database or a build artifact.

## Local setup

The development fallback connects to `gitatlas_dev` through the local
`/run/postgresql` socket. Override it with `GITATLAS_DATABASE_URL` when using a
different PostgreSQL instance. Production must set
`GITATLAS_DATABASE_URL` or a PostgreSQL `DATABASE_URL`; SQLite URLs are rejected.

Apply versioned schema changes with:

```sh
bun run db:migrate
```

## Import existing data

After the PostgreSQL migrations have been applied, transfer the legacy tables
with:

```sh
bun run db:import-sqlite
```

`LEGACY_SQLITE_PATH` can select another SQLite source. The importer opens it
read-only, inserts all four legacy models in one PostgreSQL transaction, keeps
the original IDs and values, and skips rows already imported with identical
values. A conflicting ID or unique key stops the transaction rather than
overwriting PostgreSQL data. The command reports only row counts, not source
contents. Re-running it is safe.

The migration does not drop or reset target tables. Keep the SQLite source as a
separate backup until the PostgreSQL row counts and representative metadata and
analysis history have been checked.