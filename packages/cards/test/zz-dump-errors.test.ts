import { describe, expect, it } from 'vitest';
import { validateCorpus } from '../src/validate.js';

describe('dump errors', () => {
  it('prints all errors', () => {
    const report = validateCorpus();
    console.log('ERRORS:', JSON.stringify(report.errors, null, 2));
    console.log('WARNINGS:', JSON.stringify(report.warnings, null, 2));
    expect(report.errors).toHaveLength(0);
  });
});
