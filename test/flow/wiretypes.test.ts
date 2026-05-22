/**
 * Tests for the wire-type validator.
 *
 * Naming: test_wiretypes_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import { validateWireTypes } from '../../src/server/flow/wiretypes.js';
import type { SchemaDefinition } from '../../src/server/extractor/types.js';

function makeNode(
  id: string,
  type: string,
  wires: string[][] = [],
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, type, x: 0, y: 0, wires, ...extras };
}

function makeSchema(nodeId: string, fields: Record<string, string>): SchemaDefinition {
  return { nodeId, fields };
}

describe('validateWireTypes — happy paths', () => {
  it('test_wiretypes_empty_nodes_pass', () => {
    const r = validateWireTypes([], []);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('test_wiretypes_no_schemas_pass', () => {
    const nodes = [makeNode('a', 'inject', [['b']]), makeNode('b', 'debug', [])];
    const r = validateWireTypes(nodes, []);
    expect(r.ok).toBe(true);
  });

  it('test_wiretypes_source_with_schema_to_non_schema_target_pass', () => {
    const nodes = [makeNode('a', 'inject', [['b']]), makeNode('b', 'debug', [])];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });

  it('test_wiretypes_compatible_schema_and_definition_pass', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: '{"payload":"string"}' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });

  it('test_wiretypes_source_superset_of_schema_definition_pass', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: '{"payload":"string"}' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string', extra: 'number' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });
});

describe('validateWireTypes — mismatches', () => {
  it('test_wiretypes_missing_field_on_wire_is_type_mismatch', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: '{"payload":"string","count":"number"}' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]?.type).toBe('type-mismatch');
    expect(r.issues[0]?.detail).toContain('missing required field "count"');
  });

  it('test_wiretypes_wrong_type_on_wire_is_type_mismatch', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: '{"payload":"number"}' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.detail).toContain('field "payload": expected number, source provides string');
  });

  it('test_wiretypes_multiple_wires_report_multiple_issues', () => {
    const nodes = [
      makeNode('a', 'inject', [['b'], ['c']]),
      makeNode('b', 'schema', [], { definition: '{"x":"number"}' }),
      makeNode('c', 'schema', [], { definition: '{"y":"boolean"}' }),
    ];
    const schemas = [makeSchema('a', { x: 'string', y: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(2);
  });

  it('test_wiretypes_dangling_wire_is_ignored', () => {
    const nodes = [makeNode('a', 'inject', [['missing']])];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });
});

describe('validateWireTypes — optional fields', () => {
  it('test_wiretypes_optional_target_field_may_be_absent', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: '{"payload":"string","count?":"number"}' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });
});

describe('validateWireTypes — schema node definition parsing', () => {
  it('test_wiretypes_invalid_json_definition_is_ignored', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: 'not json' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });

  it('test_wiretypes_non_object_definition_is_ignored', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: '"string"' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });

  it('test_wiretypes_non_string_values_in_definition_is_ignored', () => {
    const nodes = [
      makeNode('a', 'inject', [['b']]),
      makeNode('b', 'schema', [], { definition: '{"payload":123}' }),
    ];
    const schemas = [makeSchema('a', { payload: 'string' })];
    const r = validateWireTypes(nodes, schemas);
    expect(r.ok).toBe(true);
  });
});
