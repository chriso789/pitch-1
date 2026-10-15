import { describe, it, expect } from 'vitest';
import { reorderPages } from '@/lib/scan-records/reorderPages';

describe('reorderPages', () => {
  it('moves a page forward and back without losing pages', () => {
    expect(reorderPages([1, 2, 3, 4, 5], 0, 3)).toEqual([2, 3, 4, 1, 5]);
    expect(reorderPages([1, 2, 3, 4, 5], 4, 1)).toEqual([1, 5, 2, 3, 4]);
  });
  it('ignores invalid or no-op moves', () => {
    const a = [1, 2, 3];
    expect(reorderPages(a, 1, 1)).toBe(a);
    expect(reorderPages(a, -1, 2)).toBe(a);
    expect(reorderPages(a, 0, 9)).toBe(a);
  });
});
