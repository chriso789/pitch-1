import { it, vi } from 'vitest';
// Run the exact same edge regressions locally without downloading the entire
// application's dependency graph through the Deno resolver.
vi.stubGlobal('Deno', { test: it, env: { get: () => undefined } });
await import('../supabase/functions/_shared/workflow_completion_test.ts');
