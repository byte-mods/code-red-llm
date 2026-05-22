/**
 * Smoke test — proves the Vitest harness is alive and the TS↔test path link
 * round-trips through `tsconfig.json`. If this fails, no other suite will
 * succeed; gate the rest of the project on this passing.
 *
 * Naming convention for future tests:
 *   test_<component>_<scenario>_<expected_behavior>
 * Smoke is the one exception — it is not testing a component.
 */
import { describe, expect, it } from 'vitest';
import { PLUGIN_ID } from '../src/server/index.js';

describe('harness smoke', () => {
  it('runs the suite and imports compiled-style paths', () => {
    expect(PLUGIN_ID).toBe('no-code-red');
  });

  it('exercises basic assertion plumbing', () => {
    expect(2 + 2).toBe(4);
    expect([1, 2, 3]).toHaveLength(3);
  });
});
