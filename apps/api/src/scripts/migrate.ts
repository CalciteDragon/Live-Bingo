import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runner } from 'node-pg-migrate';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Check apps/api/.env.');
  process.exit(1);
}

await runner({
  databaseUrl,
  dir: migrationsDir,
  direction: 'up',
  migrationsTable: 'pgmigrations',
});
