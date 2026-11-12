import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

/**
 * Vitest Configuration for Unit & Integration Testing
 * Phase 1 - Week 1-2: Testing Infrastructure
 */

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, 'tests/workflow-completion.test.ts', 'tests/workflow-migration.test.ts', 'tests/workflow-financials.test.ts'],
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'e2e/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/dist/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@/integrations/supabase/client': path.resolve(__dirname, './tests/mocks/supabaseOfflineClient.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
