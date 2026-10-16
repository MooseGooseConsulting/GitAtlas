/// <reference types="bun-types" />

import { Database } from 'bun:sqlite';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { importSqliteDatabase } from './import-sqlite';
import { resolveDatabaseUrl } from './database-url-resolve';

const databaseUrl = resolveDatabaseUrl();
const db = new PrismaClient({ datasourceUrl: databaseUrl });

const sourcePath = resolve(process.env.LEGACY_SQLITE_PATH ?? 'db/custom.db');
const tableNames = [
  'Project',
  'AnalysisJob',
  'CommitActivityCache',
  'RecentCommitsCache',
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  assert(databaseUrl.startsWith('postgres'), 'Migration test requires a PostgreSQL URL.');

  const source = new Database(sourcePath, { readonly: true, strict: true });
  const sourceCounts: Record<string, number> = {};
  for (const table of tableNames) {
    const result = source.query(`SELECT count(*) AS count FROM "${table}"`).get() as {
      count: number;
    };
    sourceCounts[table] = result.count;
  }
  const legacyProject = source
    .query(
      'SELECT id, "githubId" FROM "Project" ORDER BY id LIMIT 1',
    )
    .get() as { id: string; githubId: number } | null;
  const legacyAnalysisJob = source
    .query(
      'SELECT id FROM "AnalysisJob" ORDER BY id LIMIT 1',
    )
    .get() as { id: string } | null;
  const legacyCommitCache = source
    .query(
      'SELECT id, username FROM "CommitActivityCache" ORDER BY id LIMIT 1',
    )
    .get() as { id: string; username: string } | null;
  source.close();

  assert(legacyProject, "Legacy SQLite source has no project fixture.");
  const initial = await importSqliteDatabase(sourcePath, db);
  for (const table of tableNames) {
    assert(
      initial.totals[table] >= sourceCounts[table],
      `${table} count is below the legacy source count.`
    );
  }

  const rerun = await importSqliteDatabase(sourcePath, db);
  for (const table of tableNames) {
    assert(
      rerun.importCounts[table].imported === 0,
      `${table} importer was not idempotent on rerun.`,
    );
    assert(
      rerun.importCounts[table].skipped === sourceCounts[table] &&
        rerun.importCounts[table].divergent === 0,
      `${table} identical rerun was not reported as identical skips.`,
    );
    assert(
      rerun.totals[table] === initial.totals[table],
      `${table} total changed on import rerun.`,
    );
  }
  console.log("Identical import rerun preserved all legacy row counts.");

  const refreshedValue = "migration-test-refreshed-value";
  await db.project.update({
    where: { id: legacyProject.id },
    data: { fullName: refreshedValue },
  });
  const changedRowRerun = await importSqliteDatabase(sourcePath, db);
  assert(
    changedRowRerun.importCounts.Project.divergent >= 1,
    "Changed same-ID Project row was not reported as divergent.",
  );
  assert(
    (await db.project.findUnique({ where: { id: legacyProject.id } }))
      ?.fullName === refreshedValue,
    "Changed PostgreSQL Project row was overwritten by the legacy importer.",
  );
  console.log("Changed same-ID row was reported and preserved.");

  const restartedClient = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    for (const table of tableNames) {
      const modelName = {
        Project: 'project',
        AnalysisJob: 'analysisJob',
        CommitActivityCache: 'commitActivityCache',
        RecentCommitsCache: 'recentCommitsCache',
      }[table] as 'project' | 'analysisJob' | 'commitActivityCache' | 'recentCommitsCache';
      const count = await (
        restartedClient[modelName] as unknown as { count(): Promise<number> }
      ).count();
      assert(count === initial.totals[table], `${table} count changed after client restart.`);
    }
  } finally {
    await restartedClient.$disconnect();
  }

  const projectToMove = await db.project.findUnique({
    where: { id: legacyProject.id },
  });
  assert(projectToMove, "Imported Project fixture is missing.");
  await db.project.delete({ where: { id: legacyProject.id } });
  const conflictingProjectId = "migration-project-natural-key-conflict";
  await db.project.create({
    data: { ...projectToMove, id: conflictingProjectId },
  });
  let projectNaturalKeyConflictRejected = false;
  try {
    await importSqliteDatabase(sourcePath, db);
  } catch {
    projectNaturalKeyConflictRejected = true;
  }
  assert(
    projectNaturalKeyConflictRejected,
    "Different-ID Project githubId collision did not fail the import.",
  );
  assert(
    !(await db.project.findUnique({ where: { id: legacyProject.id } })) &&
      // Prisma returns githubId as bigint on PostgreSQL while SQLite yields a
      // number; compare BigInt-aware so the identity check is type-stable.
      (await db.project.findUnique({ where: { id: conflictingProjectId } }))
        ?.githubId === BigInt(legacyProject.githubId),
    "Project natural-key conflict changed the existing PostgreSQL identity.",
  );
  await db.project.delete({ where: { id: conflictingProjectId } });
  const projectRestored = await importSqliteDatabase(sourcePath, db);
  assert(
    projectRestored.importCounts.Project.imported === 1,
    "Importer did not recover after removing the different-ID Project conflict.",
  );
  console.log("Different-ID Project githubId conflict was safely rejected.");

  assert(
    legacyAnalysisJob && legacyCommitCache,
    "Legacy source is missing rollback conflict fixtures.",
  );
  await db.analysisJob.delete({ where: { id: legacyAnalysisJob.id } });
  const removedAnalysisJobCount = await db.analysisJob.count();
  const removedLegacyCache = await db.commitActivityCache.delete({
    where: { id: legacyCommitCache.id },
  });
  await db.commitActivityCache.create({
    data: {
      id: "migration-natural-key-conflict",
      username: removedLegacyCache.username,
      activityJson: "[]",
    },
  });
  let naturalKeyConflictRejected = false;
  try {
    await importSqliteDatabase(sourcePath, db);
  } catch {
    naturalKeyConflictRejected = true;
  }
  assert(
    naturalKeyConflictRejected,
    "Different-ID natural-key collision did not fail the import.",
  );
  assert(
    (await db.analysisJob.count()) === removedAnalysisJobCount,
    "Import transaction did not roll back earlier pending rows after a natural-key conflict.",
  );
  assert(
    !(await db.analysisJob.findUnique({
      where: { id: legacyAnalysisJob.id },
    })),
    "Import transaction restored the deliberately removed AnalysisJob row.",
  );
  console.log("Natural-key conflict rolled back pending table imports.");

  const smokeId = 'gitatlas-postgres-prisma-smoke';
  await db.$transaction(async (transaction) => {
    const existing = await transaction.project.findUnique({ where: { id: smokeId } });
    assert(!existing, 'Prisma smoke-test ID already exists; refusing to overwrite it.');

    const created = await transaction.project.create({
      data: {
        id: smokeId,
        githubId: -2_147_483_000,
        name: 'postgres-prisma-smoke',
        fullName: 'gitatlas-internal/postgres-prisma-smoke',
        htmlUrl: 'https://github.com/gitatlas-internal/postgres-prisma-smoke',
        githubCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        githubUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ownerLogin: 'gitatlas-internal',
      },
    });
    assert(created.id === smokeId, 'Prisma did not return the inserted project.');

    const read = await transaction.project.findUnique({ where: { id: smokeId } });
    // githubId is BigInt on PostgreSQL; compare against a bigint literal.
    assert(read?.githubId === BigInt(-2_147_483_000), 'Prisma could not read the inserted project.');

    const updated = await transaction.project.update({
      where: { id: smokeId },
      data: { summary: 'postgres write verified' },
    });
    assert(updated.summary === 'postgres write verified', 'Prisma update did not persist.');
    await transaction.project.delete({ where: { id: smokeId } });
  });

  console.log(
    tableNames.map((table) => `${table}=${sourceCounts[table]}`).join(' ')
  );
  console.log('Prisma PostgreSQL create/read/update/delete smoke test passed.');
}

run()
  .catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database URL]')
        : 'Unknown migration validation error';
    console.error(`PostgreSQL migration validation failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });