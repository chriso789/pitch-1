import { describe, expect, it } from 'vitest';
import { classifySource, parseCostCents, totalCost, costPerLead } from '../../src/lib/marketingAudit';

describe('marketing audit', () => {
  it('keeps generic or missing sources unattributed', () => {
    for (const source of [null, '', 'website', 'social_media', 'advertisement']) expect(classifySource(source)).toBe('unknown');
    expect(classifySource('Facebook Ads')).toBe('facebook');
    expect(classifySource('instagram')).toBe('instagram');
    expect(classifySource('google_ads')).toBe('google');
    expect(classifySource('Yelp')).toBe('yelp');
  });
  it('uses exact integer cents and rejects invalid costs', () => {
    expect(parseCostCents('12.10')).toBe(1210);
    expect(parseCostCents('0.01')).toBe(1);
    for (const value of ['-5', '0', '1.234', 'NaN', '1e3']) expect(() => parseCostCents(value)).toThrow();
  });
  it('subtracts credits without editing history and never invents CPL', () => {
    expect(totalCost([{ amount_cents: 10000, entry_type: 'expense' }, { amount_cents: 2500, entry_type: 'credit' }])).toBe(7500);
    expect(costPerLead(7500, 3)).toBe(25);
    expect(costPerLead(7500, 0)).toBeNull();
  });
});