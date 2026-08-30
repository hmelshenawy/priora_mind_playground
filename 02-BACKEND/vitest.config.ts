import { defineConfig } from 'vitest/config';

/**
 * Vitest config — unit + contract tests.
 * Pure-function tests (scoring, DTO validation, redact) run with no DB.
 * Contract tests (NestJS + supertest) boot an isolated app; the DB is handled
 * per-suite in the Foundational/Story phases.
 */
export default defineConfig({
  test: {
    root: './',
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts', 'tests/contract/**/*.spec.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['tests/**', 'dist/**', 'src/main.ts', '**/*.module.ts'],
    },
  },
});
