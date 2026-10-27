import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanString, normalizeState, normalizeZipCode, normalizeStatus, normalizeRow } from '../src/etl/normalizer';

test('cleanString strips extra whitespace and non-printables', () => {
  assert.equal(cleanString('  Google   LLC   '), 'Google LLC');
  assert.equal(cleanString(null), '');
  assert.equal(cleanString(undefined), '');
});

test('normalizeState handles 2-letter codes and full names', () => {
  assert.equal(normalizeState('CA'), 'CA');
  assert.equal(normalizeState('ca'), 'CA');
  assert.equal(normalizeState('California'), 'CA');
  assert.equal(normalizeState('new york'), 'NY');
  assert.equal(normalizeState('InvalidStateCode'), '');
});

test('normalizeZipCode standardizes 5-digit and ZIP+4', () => {
  assert.equal(normalizeZipCode('94043'), '94043');
  assert.equal(normalizeZipCode('98052-6399'), '98052-6399');
  assert.equal(normalizeZipCode('94043 1234'), '94043-1234');
});

test('normalizeStatus accurately detects active vs terminated', () => {
  assert.equal(normalizeStatus('Active'), 'Active');
  assert.equal(normalizeStatus('Terminated'), 'Terminated');
  assert.equal(normalizeStatus('Inactive / Closed'), 'Terminated');
  assert.equal(normalizeStatus(undefined), 'Active');
});

test('normalizeRow parses raw CSV format with case-insensitive headers', () => {
  const row = {
    'Employer Name': '  Apple Inc. ',
    'Street Address': 'One Apple Park Way',
    'City': 'Cupertino',
    'State': 'CA',
    'Zip Code': '95014',
    'Status': 'Active',
  };

  const normalized = normalizeRow(row);
  assert.notEqual(normalized, null);
  assert.equal(normalized?.employerName, 'Apple Inc.');
  assert.equal(normalized?.address, 'One Apple Park Way');
  assert.equal(normalized?.city, 'Cupertino');
  assert.equal(normalized?.state, 'CA');
  assert.equal(normalized?.zipCode, '95014');
  assert.equal(normalized?.status, 'Active');
});

test('normalizeRow returns null for records without company name', () => {
  const row = {
    'Employer Name': '   ',
    'City': 'San Francisco',
  };
  assert.equal(normalizeRow(row), null);
});
