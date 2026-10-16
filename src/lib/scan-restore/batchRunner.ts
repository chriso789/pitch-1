/**
 * Runs per-page scan work with bounded concurrency, progress reporting and cancellation.
 * Replaces unbounded Promise.all so large multipage scans don't decode every page at once.
 * Results already finished before a cancel are returned so the caller can keep them;
 * pages not processed keep their previous image (originals are never touched here).
 */
export interface BatchProgress { done: number; total: number }
export interface BatchResult<T> { results: (T | null)[]; cancelled: boolean; errors: { index: number; error: Error }[] }

export async function runBatch<I, T>(
  items: I[],
  fn: (item: I, index: number, signal?: AbortSignal) => Promise<T | null>,
  opts: { concurrency?: number; signal?: AbortSignal; onProgress?: (p: BatchProgress) => void } = {},
): Promise<BatchResult<T>> {
  const total = items.length;
  const results: (T | null)[] = new Array(total).fill(null);
  const errors: { index: number; error: Error }[] = [];
  const limit = Math.max(1, Math.min(opts.concurrency ?? 1, total || 1));
  let next = 0; let done = 0;
  opts.onProgress?.({ done, total });
  const worker = async () => {
    while (next < total) {
      if (opts.signal?.aborted) return;
      const i = next++;
      try { results[i] = await fn(items[i], i, opts.signal); }
      catch (e: any) {
        if (e?.name === 'AbortError') return;
        errors.push({ index: i, error: e instanceof Error ? e : new Error(String(e)) });
      }
      done++; opts.onProgress?.({ done, total });
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return { results, cancelled: !!opts.signal?.aborted, errors };
}
