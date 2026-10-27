import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import csvParser from 'csv-parser';
import { normalizeRow } from '../src/etl/normalizer';
import { NormalizedEmployer } from '../src/common/types';

test('ETL stream parses sample CSV and filters valid rows', async () => {
  const samplePath = path.resolve(process.cwd(), 'data/sample_everify_data.csv');
  assert.ok(fs.existsSync(samplePath), 'sample_everify_data.csv must exist');

  const rows: NormalizedEmployer[] = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(samplePath)
      .pipe(csvParser({ mapHeaders: ({ header }) => header.trim() }))
      .on('data', (raw) => {
        const norm = normalizeRow(raw);
        if (norm) rows.push(norm);
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(err));
  });

  assert.ok(rows.length >= 40, `Expected at least 40 rows, got ${rows.length}`);
  const google = rows.find((r) => r.employerName === 'Google LLC');
  assert.ok(google, 'Google LLC should be present in parsed dataset');
  assert.equal(google?.state, 'CA');
  assert.equal(google?.status, 'Active');

  const terminated = rows.find((r) => r.status === 'Terminated');
  assert.ok(terminated, 'Terminated employer should be recognized');
});

test('Batch parameter construction enforces strict 6-param mapping per row', () => {
  const sampleBatch: NormalizedEmployer[] = [
    {
      employerName: 'Company A',
      address: '123 St',
      city: 'City A',
      state: 'CA',
      zipCode: '90001',
      status: 'Active',
    },
    {
      employerName: 'Company B',
      address: null,
      city: null,
      state: 'WA',
      zipCode: '98001',
      status: 'Active',
    },
  ];

  const valueClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const emp of sampleBatch) {
    valueClauses.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, CURRENT_TIMESTAMP)`
    );
    params.push(
      emp.employerName,
      emp.address,
      emp.city,
      emp.state,
      emp.zipCode,
      emp.status
    );
    paramIndex += 6;
  }

  assert.equal(valueClauses.length, 2);
  assert.equal(params.length, 12);
  assert.equal(params[0], 'Company A');
  assert.equal(params[6], 'Company B');
  assert.equal(params[7], null);
});
