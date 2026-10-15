import { describe, it, expect } from 'vitest';
import { restoreScanAsync, restoreScanSync } from '@/lib/scan-restore/restoreAsync';

const mk = () => { const d = new Uint8ClampedArray(16 * 16 * 4); for (let i = 0; i < d.length; i += 4) { d[i] = d[i+1] = d[i+2] = i % 64 === 0 ? 20 : 200; d[i+3] = 255; } return { data: d, width: 16, height: 16 }; };

describe('off-main-thread cleanup', () => {
  it('matches the synchronous result and leaves original pixels intact', async () => {
    const img = mk(); const before = new Uint8ClampedArray(img.data);
    const a = await restoreScanAsync(img, 'auto');
    expect(Array.from(a.img.data)).toEqual(Array.from(restoreScanSync(mk(), 'auto', {}, true).img.data));
    expect(Array.from(img.data)).toEqual(Array.from(before));
  });
  it('rejects when cancelled before starting', async () => {
    const c = new AbortController(); c.abort();
    await expect(restoreScanAsync(mk(), 'auto', {}, true, c.signal)).rejects.toThrow();
  });
});
