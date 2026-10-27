import * as fs from 'fs';
import * as path from 'path';
import { query, pool } from '../common/database';

export async function runMigration(): Promise<void> {
  const candidatePaths = [
    path.resolve(process.cwd(), 'sql/001_init_schema.sql'),
    path.resolve(__dirname, '../../../sql/001_init_schema.sql'),
    path.resolve(__dirname, '../../sql/001_init_schema.sql'),
  ];

  const sqlPath = candidatePaths.find(p => fs.existsSync(p));
  if (!sqlPath) {
    throw new Error(`Schema file not found in candidates: ${candidatePaths.join(', ')}`);
  }

  console.log(`[MIGRATION] Reading schema file from: ${sqlPath}`);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('[MIGRATION] Applying schema and GIN trigram indexes to PostgreSQL...');
  
  await query(sql);
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
