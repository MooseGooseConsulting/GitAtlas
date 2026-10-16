/// <reference types="bun-types" />

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./database-url-resolve";

async function runCommand(command: string[], databaseUrl: string) {
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GITATLAS_DATABASE_URL: databaseUrl,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Isolated migration command failed: ${command.join(" ")}`);
  }
}

async function main() {
  const baseUrl = resolveDatabaseUrl();
  const databaseUrl = new URL(baseUrl);
  if (
    databaseUrl.protocol !== "postgresql:" &&
    databaseUrl.protocol !== "postgres:"
  ) {
    throw new Error("Migration verification requires PostgreSQL.");
  }

  const schema = `gitatlas_verify_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.searchParams.set("schema", schema);
  const admin = new PrismaClient({ datasourceUrl: baseUrl });
  let schemaCreated = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    console.log(`Running migration verification in isolated schema ${schema}.`);
    await runCommand(
      [process.execPath, "scripts/migrate.ts"],
      isolatedUrl.toString(),
    );
    await runCommand(
      [process.execPath, "scripts/migrate.ts"],
      isolatedUrl.toString(),
    );
    await runCommand(
      [process.execPath, "scripts/test-postgres-migration.ts"],
      isolatedUrl.toString(),
    );
  } finally {
    if (schemaCreated) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      console.log(`Dropped isolated migration schema ${schema}.`);
    }
    await admin.$disconnect();
  }
}

main().catch(() => {
  console.error(
    "Isolated PostgreSQL migration verification failed; live data was not targeted.",
  );
  process.exitCode = 1;
});