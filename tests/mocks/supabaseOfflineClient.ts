import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types';
// Local-only endpoint plus an explicit transport refusal: test imports cannot
// inherit the generated production client's URL/key or open remote realtime.
export const supabase = createClient<Database>('http://127.0.0.1:9', 'unit-test-only', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async () => { throw new Error('Supabase network disabled in unit tests'); } },
});
