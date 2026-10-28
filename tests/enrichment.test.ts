import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  coreTokens,
  slugCandidates,
  tokenOverlap,
  classifySeniority,
  isDirectoryHost,
  extractState,
} from '../src/enrichment/text-utils';
import { detectAts } from '../src/enrichment/ats';

describe('Enrichment Text & Domain Utilities', () => {
  it('coreTokens strips legal entity corporate suffixes', () => {
    const tokens = coreTokens('DATABRICKS, INC.');
    assert.deepStrictEqual(tokens, ['databricks']);

    const googleTokens = coreTokens('Google LLC');
    assert.deepStrictEqual(googleTokens, ['google']);

    const snowflakeTokens = coreTokens('Snowflake Corporation');
    assert.deepStrictEqual(snowflakeTokens, ['snowflake']);
  });

  it('slugCandidates produces clean slugs for matching', () => {
    const slugs = slugCandidates('Space Exploration Technologies Corp.');
    assert.ok(slugs.includes('spaceexplorationtechnologies'));
    assert.ok(slugs.length >= 1);
  });

  it('tokenOverlap calculates word similarity accurately', () => {
    const tokens = coreTokens('Databricks Inc');
    const score1 = tokenOverlap(tokens, 'databricks cloud data platform');
    assert.strictEqual(score1, 1.0, 'Should match 100% when core token is present');

    const score2 = tokenOverlap(tokens, 'microsoft office cloud');
    assert.strictEqual(score2, 0.0, 'Should be 0% when no tokens present');
  });

  it('classifySeniority correctly tags job levels', () => {
    assert.strictEqual(classifySeniority('Software Engineering Intern'), 'intern');
    assert.strictEqual(classifySeniority('Junior Frontend Developer'), 'entry');
    assert.strictEqual(classifySeniority('Staff Systems Architect'), 'senior');
    assert.strictEqual(classifySeniority('Lead Security Engineer'), 'senior');
    assert.strictEqual(classifySeniority('Data Analyst'), 'mid');
  });

  it('isDirectoryHost flags aggregator and directory websites', () => {
    assert.strictEqual(isDirectoryHost('www.linkedin.com'), true);
    assert.strictEqual(isDirectoryHost('yelp.com'), true);
    assert.strictEqual(isDirectoryHost('manta.com'), true);
    assert.strictEqual(isDirectoryHost('databricks.com'), false);
    assert.strictEqual(isDirectoryHost('spacex.com'), false);
  });

  it('extractState identifies US states in strings', () => {
    assert.strictEqual(extractState('San Francisco, CA'), 'CA');
    assert.strictEqual(extractState('Austin, Texas'), 'TX');
    assert.strictEqual(extractState('London, United Kingdom'), null);
  });

  it('detectAts identifies Greenhouse, Lever, Ashby and other ATS embeds', () => {
    const ghHtml = '<div id="grnhse_app"></div><a href="https://boards.greenhouse.io/databricks">Careers</a>';
    const ats = detectAts(ghHtml);
    assert.strictEqual(ats?.type, 'greenhouse');
    assert.strictEqual(ats?.token, 'databricks');

    const leverHtml = '<a href="https://jobs.lever.co/figma">View Figma Jobs</a>';
    const leverAts = detectAts(leverHtml);
    assert.strictEqual(leverAts?.type, 'lever');
    assert.strictEqual(leverAts?.token, 'figma');
  });
});
