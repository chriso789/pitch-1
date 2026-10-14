import { describe, it, expect } from 'vitest';
import { regionTitle } from '@/lib/pdf-compare/reviewItems';

describe('review item titles', () => {
  it('locates the region as a percent of the sheet', () => {
    expect(regionTitle('rfi', { x: 250, y: 100, w: 10, h: 10, kind: 'added', pixels: 50 }, 0, 3, { w: 1000, h: 500 }))
      .toBe('RFI: added area #1, page 3 (25% from left, 20% from top)');
  });
  it('stays within the 200-character limit', () => {
    expect(regionTitle('change_order_review', { x: 0, y: 0, w: 1, h: 1, kind: 'modified', pixels: 1 }, 9999, 1, { w: 1, h: 1 }).length).toBeLessThanOrEqual(200);
  });
});
