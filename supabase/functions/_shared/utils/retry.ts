// supabase/functions/_shared/utils/retry.ts

export async function retry<T>(
  fn: () => Promise<T>,
  options: { retries: number; baseDelay: number; factor?: number }
): Promise<T> {
  const { retries, baseDelay, factor = 2 } = options;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = baseDelay * Math.pow(factor, attempt);
      await new Promise((res) => setTimeout(res, delay));
      attempt++;
    }
  }
}
