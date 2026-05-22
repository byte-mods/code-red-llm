/**
 * Tests for the hand-rolled Node-RED node validator.
 *
 * Strategy: feed `validateNode` everything that can fall out of JSON.parse —
 * primitives, null, arrays, missing-required, wrong-typed-required,
 * present-wrong-optional, deeply malformed wires, edge numbers (NaN,
 * Infinity). Aggregation behaviour matters: one bad node should yield the
 * full error list, not just the first defect.
 *
 * Naming: test_validateNode_<scenario>_<expected_behavior>.
 */
import { describe, expect, it } from 'vitest';

import { validateNode } from '../../src/server/extractor/index.js';

/** A minimal valid candidate. Tests mutate clones of this base. */
const baseValid: Record<string, unknown> = {
  id: 'n1',
  type: 'inject',
  x: 100,
  y: 100,
  wires: [['n2']],
};

describe('validateNode — non-object inputs', () => {
  it('test_validateNode_null_is_rejected', () => {
    const r = validateNode(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('node must be a JSON object');
  });

  it('test_validateNode_undefined_is_rejected', () => {
    const r = validateNode(undefined);
    expect(r.ok).toBe(false);
  });

  it('test_validateNode_string_is_rejected', () => {
    const r = validateNode('not a node');
    expect(r.ok).toBe(false);
  });

  it('test_validateNode_array_is_rejected', () => {
    const r = validateNode([1, 2, 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('node must be a JSON object');
  });
});

describe('validateNode — required fields', () => {
  it('test_validateNode_passes_minimal_valid_node', () => {
    const r = validateNode({ ...baseValid });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.id).toBe('n1');
      expect(r.node.type).toBe('inject');
      expect(r.node.x).toBe(100);
      expect(r.node.y).toBe(100);
      expect(r.node.wires).toEqual([['n2']]);
      expect(r.node.extras).toEqual({});
    }
  });

  it('test_validateNode_missing_id_reports_error', () => {
    const { id: _id, ...rest } = baseValid;
    const r = validateNode(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('id must be a string');
  });

  it('test_validateNode_wrong_type_for_id_reports_error', () => {
    const r = validateNode({ ...baseValid, id: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('id must be a string');
  });

  it('test_validateNode_missing_type_reports_error', () => {
    const { type: _type, ...rest } = baseValid;
    const r = validateNode(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('type must be a string');
  });

  it('test_validateNode_nan_x_rejected_as_non_finite', () => {
    const r = validateNode({ ...baseValid, x: Number.NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('x must be a finite number');
  });

  it('test_validateNode_infinity_y_rejected_as_non_finite', () => {
    const r = validateNode({ ...baseValid, y: Number.POSITIVE_INFINITY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('y must be a finite number');
  });

  it('test_validateNode_aggregates_every_required_error', () => {
    const r = validateNode({}); // nothing valid
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('id must be a string');
      expect(r.errors).toContain('type must be a string');
      expect(r.errors).toContain('x must be a finite number');
      expect(r.errors).toContain('y must be a finite number');
      expect(r.errors).toContain('wires must be an array');
      expect(r.errors.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('validateNode — wires shape', () => {
  it('test_validateNode_wires_not_array_reports_error', () => {
    const r = validateNode({ ...baseValid, wires: 'not-an-array' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('wires must be an array');
  });

  it('test_validateNode_wires_inner_not_array_reports_indexed_error', () => {
    const r = validateNode({ ...baseValid, wires: [['n2'], 'oops'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('wires[1] must be an array');
  });

  it('test_validateNode_wires_inner_non_string_reports_indexed_error', () => {
    const r = validateNode({ ...baseValid, wires: [['n2'], [3]] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('wires[1][0] must be a string');
  });

  it('test_validateNode_empty_wires_array_passes', () => {
    // Sink nodes (debug, output) legitimately have wires:[].
    const r = validateNode({ ...baseValid, wires: [] });
    expect(r.ok).toBe(true);
  });

  it('test_validateNode_empty_inner_wires_passes', () => {
    // A node with one output port that is wired to nothing.
    const r = validateNode({ ...baseValid, wires: [[]] });
    expect(r.ok).toBe(true);
  });
});

describe('validateNode — optional fields', () => {
  it('test_validateNode_omits_absent_optional_fields', () => {
    const r = validateNode({ ...baseValid });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.name).toBeUndefined();
      expect(r.node.z).toBeUndefined();
    }
  });

  it('test_validateNode_threads_present_optional_fields', () => {
    const r = validateNode({ ...baseValid, name: 'every 30s', z: 'flow-main' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.name).toBe('every 30s');
      expect(r.node.z).toBe('flow-main');
    }
  });

  it('test_validateNode_present_wrong_type_optional_reports_error', () => {
    const r = validateNode({ ...baseValid, name: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('name must be a string when present');
  });

  it('test_validateNode_wrong_typed_z_reports_error', () => {
    const r = validateNode({ ...baseValid, z: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('z must be a string when present');
  });
});

describe('validateNode — extras pass-through', () => {
  it('test_validateNode_preserves_unknown_fields_in_extras', () => {
    const r = validateNode({
      ...baseValid,
      url: 'https://example.com',
      method: 'GET',
      props: [{ p: 'payload' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.extras).toEqual({
        url: 'https://example.com',
        method: 'GET',
        props: [{ p: 'payload' }],
      });
    }
  });

  it('test_validateNode_extras_excludes_required_and_optional_keys', () => {
    const r = validateNode({ ...baseValid, name: 'n', z: 'f', custom: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.extras).toEqual({ custom: 1 });
      // Required keys must not leak into extras.
      for (const k of ['id', 'type', 'x', 'y', 'wires', 'name', 'z']) {
        expect(r.node.extras).not.toHaveProperty(k);
      }
    }
  });
});

describe('validateNode — never throws', () => {
  it('test_validateNode_returns_for_pathological_inputs', () => {
    // Symbols, functions, bigints, deeply nested junk — the validator must
    // produce a result rather than throw.
    const cases: unknown[] = [
      Symbol('s'),
      () => 1,
      BigInt(1),
      { id: Symbol('x'), type: () => {}, x: BigInt(1), y: BigInt(2), wires: [[Symbol()]] },
    ];
    for (const c of cases) {
      const r = validateNode(c);
      expect(r.ok).toBe(false);
    }
  });
});
