/**
 * Vitest configuration.
 *
 * Why these settings:
 * - `environment: 'node'` is the right default — server-side code dominates the
 *   suite. S5 will add a browser-flavored config for the sidebar client when
 *   that section lands; until then keeping it node-only avoids pulling jsdom.
 * - `include` targets `test/**` plus inline `*.test.ts` under `src/**`. We
 *   prefer co-located tests next to subjects (server/parser, server/sse) but
 *   reserve `test/` for integration suites that span modules.
 * - No `globals: true` — explicit imports keep TS happy without needing a
 *   `vitest/globals` types reference.
 * - Coverage tooling is intentionally not wired here; we'll add c8 in S7 with
 *   real thresholds, not toy ones.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.history'],
    reporters: ['default'],
    passWithNoTests: false,
  },
});
