import test from 'node:test';
import assert from 'node:assert/strict';
import { EmployerService } from '../src/backend/services/employer.service';
import { EmployerRepository, SearchRepoResult } from '../src/backend/repositories/employer.repository';
import { SearchEmployersParams } from '../src/common/types';

class MockEmployerRepository extends EmployerRepository {
  public lastParams: SearchEmployersParams | null = null;
  public mockResult: SearchRepoResult = {
    records: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        employer_name: 'Google LLC',
        address: '1600 Amphitheatre Pkwy',
        city: 'Mountain View',
        state: 'CA',
        zip_code: '94043',
        status: 'Active',
        dba_name: null,
        opted_in_everify_plus: false,
        date_enrolled: '2024-01-01',
        date_terminated: null,
        workforce_size: '500 to 999',
        hiring_site_locations: 'CA, NY',
        number_of_hiring_sites: 2,
        last_updated_date: '2026-10-25',
        created_at: new Date(),
        updated_at: new Date(),
        similarity_score: 0.95,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        employer_name: 'Defunct Tech Corp',
        dba_name: 'Defunct LLC',
        address: '123 Ghost St',
        city: 'Austin',
        state: 'TX',
        zip_code: '78701',
        status: 'Terminated',
        opted_in_everify_plus: false,
        date_enrolled: '2020-01-01',
        date_terminated: '2025-01-01',
        workforce_size: '5 to 9',
        hiring_site_locations: 'TX',
        number_of_hiring_sites: 1,
        last_updated_date: '2026-01-01',
        created_at: new Date(),
        updated_at: new Date(),
        similarity_score: 0.45,
      },
    ],
    total: 2,
  };

  override async search(params: SearchEmployersParams): Promise<SearchRepoResult> {
    this.lastParams = params;
    return this.mockResult;
  }
}

test('EmployerService accurately evaluates STEM OPT eligibility', async () => {
  const mockRepo = new MockEmployerRepository();
  const service = new EmployerService(mockRepo);

  const result = await service.search({ q: 'Tech', limit: 10, page: 1 });

  assert.equal(result.success, true);
  assert.equal(result.data.length, 2);

  // Active employer must be STEM OPT eligible
  assert.equal(result.data[0]?.employerName, 'Google LLC');
  assert.equal(result.data[0]?.isStemOptEligible, true);

  // Terminated employer must NOT be STEM OPT eligible
  assert.equal(result.data[1]?.employerName, 'Defunct Tech Corp');
  assert.equal(result.data[1]?.isStemOptEligible, false);
});

test('EmployerService calculates pagination and latency telemetry', async () => {
  const mockRepo = new MockEmployerRepository();
  mockRepo.mockResult = {
    records: [],
    total: 45,
  };
  const service = new EmployerService(mockRepo);

  const result = await service.search({ q: 'Micro', limit: 20, page: 2 });

  assert.equal(result.meta.total, 45);
  assert.equal(result.meta.page, 2);
  assert.equal(result.meta.limit, 20);
  assert.equal(result.meta.totalPages, 3);
  assert.ok(result.meta.executionTimeMs >= 0);
  assert.equal(typeof result.meta.executionTimeMs, 'number');
});

test('EmployerService clamps limit between 1 and 100', async () => {
  const mockRepo = new MockEmployerRepository();
  const service = new EmployerService(mockRepo);

  await service.search({ q: 'Test', limit: 500, page: 1 });
  assert.equal(mockRepo.lastParams?.limit, 100);

  await service.search({ q: 'Test', limit: -5, page: 1 });
  assert.equal(mockRepo.lastParams?.limit, 1);
});
