/**
 * Query Batcher - Batches multiple queries into single requests
 * Phase 2: Connection & Query Optimization
 * 
 * Reduces database connections by combining multiple single-item
 * requests into batch operations. Critical for scale.
 */

export class QueryBatcher<T> {
  private queue: Array<{
    id: string;
    resolve: (data: T | null) => void;
    reject: (err: Error) => void;
  }> = [];
  private timeout: NodeJS.Timeout | null = null;

  constructor(
    private batchFn: (ids: string[]) => Promise<Record<string, T>>,
    private maxBatchSize = 50,
    private delayMs = 10
  ) {}

  /**
   * Load a single item - will be batched with other requests
   */
  async load(id: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id, resolve, reject });
      this.scheduleBatch();
    });
  }

  /**
   * Load multiple items at once
   */
  async loadMany(ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.load(id)));
  }

  private scheduleBatch(): void {
    if (this.timeout) return;
    this.timeout = setTimeout(() => this.executeBatch(), this.delayMs);
  }

  private async executeBatch(): Promise<void> {
    const batch = this.queue.splice(0, this.maxBatchSize);
    this.timeout = null;

    if (batch.length === 0) return;

    try {
      // Deduplicate IDs
      const uniqueIds = [...new Set(batch.map((b) => b.id))];
      const results = await this.batchFn(uniqueIds);

      batch.forEach(({ id, resolve }) => resolve(results[id] || null));
    } catch (error) {
      batch.forEach(({ reject }) => reject(error as Error));
    }

    // Process remaining items if queue not empty
    if (this.queue.length > 0) {
      this.scheduleBatch();
    }
  }

  /**
   * Clear pending batches (useful for cleanup)
   */
  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.queue.forEach(({ resolve }) => resolve(null));
    this.queue = [];
  }
}

// Pre-configured batchers for common use cases
import { supabase } from '@/integrations/supabase/client';

/**
 * Contact batcher - loads contacts by ID in batches
 */
export const contactBatcher = new QueryBatcher<any>(async (ids) => {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .in('id', ids);

  if (error) throw error;

  return (data || []).reduce(
    (acc, contact) => {
      acc[contact.id] = contact;
      return acc;
    },
    {} as Record<string, any>
  );
});

/**
 * Profile batcher - loads user profiles by ID in batches
 */
export const profileBatcher = new QueryBatcher<any>(async (ids) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids);

  if (error) throw error;

  return (data || []).reduce(
    (acc, profile) => {
      acc[profile.id] = profile;
      return acc;
    },
    {} as Record<string, any>
  );
});

/**
 * Job batcher - loads jobs by ID in batches
 */
export const jobBatcher = new QueryBatcher<any>(async (ids) => {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .in('id', ids);

  if (error) throw error;

  return (data || []).reduce(
    (acc, job) => {
      acc[job.id] = job;
      return acc;
    },
    {} as Record<string, any>
  );
});
