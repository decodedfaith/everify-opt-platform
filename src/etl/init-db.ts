import * as fs from 'fs';
import * as path from 'path';
import { query, pool } from '../common/database';

/** Ordered, idempotent schema files (002 is sample seed data and is intentionally excluded). */
const MIGRATION_FILES = ['001_init_schema.sql', '003_enrichment.sql'];

function locate(file: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'sql', file),
    path.resolve(__dirname, '../../../sql', file),
    path.resolve(__dirname, '../../sql', file),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Schema file ${file} not found in candidates: ${candidates.join(', ')}`);
  }
  return found;
}

export async function runMigration(): Promise<void> {
  for (const file of MIGRATION_FILES) {
    const sqlPath = locate(file);
    console.log(`[MIGRATION] Applying ${file} (${sqlPath})`);
    await query(fs.readFileSync(sqlPath, 'utf8'));
  }
  console.log('[MIGRATION] Schema successfully initialized!');
}

if (require.main === module) {
  runMigration()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[MIGRATION ERROR]', err);
      await pool.end();
      process.exit(1);
    });
}
