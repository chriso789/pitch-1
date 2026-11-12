import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: {
    'npm:pdf-lib@1.17.1': 'pdf-lib', 'npm:fflate@0.8.3': 'fflate',
  } },
  test: { environment: 'node', include: ['tests/workflow-completion.test.ts', 'tests/workflow-migration.test.ts', 'tests/workflow-financials.test.ts', 'tests/workflow-bootstrap.test.ts'] },
});
