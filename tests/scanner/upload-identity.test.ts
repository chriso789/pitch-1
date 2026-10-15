import { describe, it, expect } from 'vitest';
import { getOrCreateUploadId, clearUploadId, scanUploadPaths } from '@/lib/scan-records/uploadIdentity';

class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('idempotent scan upload identity', () => {
  it('reuses the same id across retries until cleared', () => {
    const s = new Mem();
    const a = getOrCreateUploadId('t1', 'rec', 'contract', s);
    expect(getOrCreateUploadId('t1', 'rec', 'contract', s)).toBe(a);
    clearUploadId('t1', 'rec', 'contract', s);
    expect(getOrCreateUploadId('t1', 'rec', 'contract', s)).not.toBe(a);
  });
  it('keeps companies apart after a company switch', () => {
    const s = new Mem();
    expect(getOrCreateUploadId('t1', 'rec', 'contract', s)).not.toBe(getOrCreateUploadId('t2', 'rec', 'contract', s));
  });
  it('writes deterministic, tenant-first paths in page order', () => {
    const p = scanUploadPaths('t1', 'rec', 'u', 'contract', 3);
    expect(p.pdf).toBe('t1/rec/u_contract.pdf');
    expect(p.originals).toEqual(['t1/rec/u_contract_originals/page_1.jpg', 't1/rec/u_contract_originals/page_2.jpg', 't1/rec/u_contract_originals/page_3.jpg']);
    expect(scanUploadPaths('t1', 'rec', 'u', 'contract', 3)).toEqual(p);
  });
});
