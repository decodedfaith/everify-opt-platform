import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SearchEmployerDto } from '../src/backend/dtos/search-employer.dto';

test('SearchEmployerDto validates valid query inputs', async () => {
  const plain = {
    q: 'Google LLC',
    state: 'ca',
    limit: '25',
    page: '1',
  };

  const dto = plainToInstance(SearchEmployerDto, plain);
  const errors = await validate(dto);

  assert.equal(errors.length, 0);
  assert.equal(dto.q, 'Google LLC');
  assert.equal(dto.state, 'CA');
  assert.equal(dto.limit, 25);
  assert.equal(dto.page, 1);
});

test('SearchEmployerDto rejects queries shorter than 2 characters', async () => {
  const plain = { q: 'a' };
  const dto = plainToInstance(SearchEmployerDto, plain);
  const errors = await validate(dto);

  assert.ok(errors.length > 0);
  const qError = errors.find((e) => e.property === 'q');
  assert.ok(qError, 'Should have validation error on "q"');
});

test('SearchEmployerDto rejects invalid state codes', async () => {
  const plain = { q: 'Apple', state: 'CALIFORNIA' };
  const dto = plainToInstance(SearchEmployerDto, plain);
  const errors = await validate(dto);

  assert.ok(errors.length > 0);
  const stateError = errors.find((e) => e.property === 'state');
  assert.ok(stateError, 'Should have validation error on "state"');
});

test('SearchEmployerDto enforces max limit of 100', async () => {
  const plain = { q: 'Microsoft', limit: 500 };
  const dto = plainToInstance(SearchEmployerDto, plain);
  const errors = await validate(dto);

  assert.ok(errors.length > 0);
  const limitError = errors.find((e) => e.property === 'limit');
  assert.ok(limitError, 'Should have validation error on "limit"');
});
