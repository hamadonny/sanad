/**
 * Applies SQL migrations from apps/api/migrations. Pure JS (no native engine), so it runs the
 * same on Windows, macOS, Linux and CI.   Usage: pnpm --filter @sanad/api db:migrate
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? 'postgresql://sanad:sanad@localhost:5433/sanad';
  runMigrations(url)
    .then(() => console.log('migrations applied'))
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
