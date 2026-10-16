import { resolveDatabaseUrl } from '../src/lib/database-url';

async function main() {
  const child = Bun.spawn([process.execPath, 'x', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: resolveDatabaseUrl(),
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  process.exitCode = await child.exited;
}

main().catch(() => {
  console.error('PostgreSQL migration failed; verify the PostgreSQL configuration.');
  process.exitCode = 1;
});