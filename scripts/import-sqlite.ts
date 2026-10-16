/// <reference types="bun-types" />

import { Database } from 'bun:sqlite';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveDatabaseUrl } from './database-url-resolve';

type LegacyRecord = Record<string, string | number | boolean | Date | null>;

type ImportModel = {
  findUnique(args: { where: Record<string, string | number> }): Promise<unknown>;
  createMany(args: { data: LegacyRecord[]; skipDuplicates: true }): Promise<{ count: number }>;
};

const importTables = [
  {
    table: 'Project',
    model: 'project',
    uniqueField: 'githubId',
    dateFields: [
      'githubCreatedAt',
      'githubUpdatedAt',
      'pushedAt',
      'analyzedAt',
      'createdAt',
      'deepAnalyzedAt',
      'readmeGeneratedAt',
    ],
    booleanFields: ['isFork', 'isArchived'],
  },
  {
    table: 'AnalysisJob',
    model: 'analysisJob',
    uniqueField: null,
    dateFields: ['createdAt', 'updatedAt'],
    booleanFields: [],
  },
  {
    table: 'CommitActivityCache',
    model: 'commitActivityCache',
    uniqueField: 'username',
    dateFields: ['fetchedAt'],
    booleanFields: [],
  },
  {
    table: 'RecentCommitsCache',
    model: 'recentCommitsCache',
    uniqueField: 'username',
    dateFields: ['fetchedAt'],
    booleanFields: [],
  },
] as const;

function normalizeRecord(
  record: LegacyRecord,
  dateFields: readonly string[],
  booleanFields: readonly string[]
): LegacyRecord {
  for (const field of dateFields) {
    const value = record[field];
    if (typeof value === 'string') {
      record[field] = new Date(value);
    } else if (typeof value === 'number') {
      record[field] = new Date(value);
    }
  }
  for (const field of booleanFields) {
    const value = record[field];
    if (typeof value === 'number') {
      record[field] = value !== 0;
    }
  }
  return record;
}

function assertSameLegacyRecord(
  tableName: string,
  expected: LegacyRecord,
  actual: unknown
): boolean {
  if (!actual || typeof actual !== 'object') {
    throw new Error(`Legacy ${tableName} row is missing after import.`);
  }

  const stored = actual as LegacyRecord;
  let matchesAll = true;
  for (const [field, value] of Object.entries(expected)) {
    const storedValue = stored[field];
    const matches =
      value instanceof Date && storedValue instanceof Date
        ? value.getTime() === storedValue.getTime()
        : typeof value === 'number' && typeof storedValue === 'bigint'
          ? BigInt(value) === storedValue
          : typeof value === 'bigint' && typeof storedValue === 'number'
            ? value === BigInt(storedValue)
            : value === storedValue;
    if (!matches) {
      matchesAll = false;
    }
  }
  return matchesAll;
}

async function importTable(
  client: PrismaClient,
  table: (typeof importTables)[number],
  records: LegacyRecord[]
): Promise<{ imported: number; skipped: number; divergent: number }> {
  const model = client[table.model] as unknown as ImportModel;
  const pending: LegacyRecord[] = [];
  let skipped = 0;
  let divergent = 0;

  for (const record of records) {
    const normalized = normalizeRecord(
      { ...record },
      table.dateFields,
      table.booleanFields
    );
    if (table.uniqueField) {
      const uniqueValue = normalized[table.uniqueField];
      if (typeof uniqueValue !== 'string' && typeof uniqueValue !== 'number') {
        throw new Error(`Invalid legacy value for ${table.table}.${table.uniqueField}.`);
      }

      const existingByNaturalKey = await model.findUnique({
        where: { [table.uniqueField]: uniqueValue },
      });
      if (
        existingByNaturalKey &&
        (existingByNaturalKey as LegacyRecord).id !== normalized.id
      ) {
        throw new Error(
          `Cannot preserve a legacy ${table.table} ID because its unique ${table.uniqueField} already belongs to another PostgreSQL row.`
        );
      }
    }

    const existingById = await model.findUnique({ where: { id: normalized.id as string } });
    if (existingById) {
      skipped++;
      if (!assertSameLegacyRecord(table.table, normalized, existingById)) {
        divergent++;
      }
      continue;
    }

    pending.push(normalized);
  }

  let imported = 0;
  if (pending.length > 0) {
    const result = await model.createMany({ data: pending, skipDuplicates: true });
    imported = result.count;
  }
  for (const expected of pending) {
    const inserted = await model.findUnique({ where: { id: expected.id as string } });
    if (!assertSameLegacyRecord(table.table, expected, inserted)) {
      throw new Error(
        `Legacy ${table.table} row diverged after insert and was not reported as imported.`
      );
    }
  }
  return { imported, skipped, divergent };
}

export async function importSqliteDatabase(sourcePath: string, prisma: PrismaClient) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Legacy SQLite database does not exist at ${sourcePath}.`);
  }

  const legacy = new Database(sourcePath, { readonly: true, strict: true });

  try {
    const data = importTables.map(({ table, dateFields }) => {
      const rows = legacy.query(`SELECT * FROM "${table}"`).all() as LegacyRecord[];
      return {
        table,
        dateFields,
        rows,
      };
    });

    const importCounts = await prisma.$transaction(async (transaction) => {
      const counts: Record<
        string,
        { imported: number; skipped: number; divergent: number }
      > = {};
      for (const imported of data) {
        const table = importTables.find((candidate) => candidate.table === imported.table)!;
        counts[imported.table] = await importTable(
          transaction as unknown as PrismaClient,
          table,
          imported.rows,
        );
      }
      return counts;
    });

    const totals: Record<string, number> = {};
    for (const entry of importTables) {
      totals[entry.table] = await (prisma[entry.model] as unknown as { count(): Promise<number> }).count();
    }
    return { importCounts, totals };
  } finally {
    legacy.close();
  }
}

async function main() {
  const sourcePath = resolve(process.env.LEGACY_SQLITE_PATH ?? 'db/custom.db');
  const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });

  try {
    const { importCounts, totals } = await importSqliteDatabase(sourcePath, prisma);
    for (const entry of importTables) {
      const counts = importCounts[entry.table];
      console.log(
        `${entry.table}: imported=${counts.imported} skipped=${counts.skipped} divergent=${counts.divergent} total=${totals[entry.table]}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  main().catch(() => {
    console.error('SQLite import failed; details were suppressed to avoid logging source data.');
    process.exitCode = 1;
  });
}