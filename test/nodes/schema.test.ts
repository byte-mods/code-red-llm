/**
 * Tests for the schema node — exercises validation by driving the
 * registered constructor against a fake Node-RED runtime. The validator
 * itself is pure; the only Node-RED-side surface is `send` (array form
 * for two outputs) and `status` (informational).
 *
 * Naming: test_schema_<scenario>_<expected_behavior>.
 */
import { describe, expect, it } from 'vitest';

import schemaNode from '../../src/server/nodes/schema.js';
import type { NodeInstance, NodeMessage, NodeRED } from '../../src/server/nodes/red-runtime.js';

interface CapturedSend {
  out: Array<NodeMessage | null>;
}

/**
 * Build a minimal RED + node double. Returns a `fire(msg)` helper that
 * invokes the registered `input` handler and captures the outgoing
 * msg array (port 0 = valid, port 1 = invalid).
 */
function setup(config: Record<string, unknown>): {
  fire: (msg: NodeMessage) => CapturedSend;
  status: () => unknown;
  errored: () => string | null;
} {
  let inputHandler: ((msg: NodeMessage, send: never, done: (e?: Error) => void) => void) | null = null;
  let lastStatus: unknown = null;
  let errorMsg: string | null = null;
  const sends: Array<NodeMessage | null>[] = [];

  const node: NodeInstance = {
    id: 'n',
    type: 'schema',
    on: (event: string, handler: (...args: never[]) => void) => {
      if (event === 'input') inputHandler = handler as never;
    },
    send: (out: NodeMessage | Array<NodeMessage | null>) => {
      sends.push(Array.isArray(out) ? out : [out]);
    },
    status: (s: unknown) => { lastStatus = s; },
    log: () => {}, warn: () => {},
    error: (e: unknown) => { errorMsg = e instanceof Error ? e.message : String(e); },
  };

  const red: NodeRED = {
    nodes: {
      registerType: (_type: string, ctor: (this: NodeInstance, c: Record<string, unknown>) => void) => {
        ctor.call(node, config);
      },
      createNode: () => {},
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  schemaNode(red);

  return {
    fire: (msg: NodeMessage) => {
      const before = sends.length;
      if (inputHandler === null) throw new Error('input handler not registered (likely bad config)');
      inputHandler(msg, undefined as never, () => {});
      const out = sends[before] ?? [];
      return { out };
    },
    status: () => lastStatus,
    errored: () => errorMsg,
  };
}

describe('schema — config errors', () => {
  it('test_schema_invalid_json_definition_reports_error_and_no_input_handler', () => {
    const s = setup({ definition: 'not-json' });
    expect(s.errored()).toContain('schema: definition is not valid JSON');
    expect(() => s.fire({ payload: {} })).toThrow();
  });

  it('test_schema_unknown_type_tag_reports_error', () => {
    const s = setup({ definition: '{"f": "foobar"}' });
    expect(s.errored()).toContain('unknown type tag "foobar"');
  });
});

describe('schema — required fields', () => {
  it('test_schema_passes_valid_payload_to_port_zero', () => {
    const s = setup({ definition: '{"id": "string", "amount": "number"}' });
    const { out } = s.fire({ payload: { id: 'o1', amount: 42.5 } });
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
    expect((out[0] as NodeMessage).payload).toEqual({ id: 'o1', amount: 42.5 });
  });

  it('test_schema_routes_missing_required_to_port_one_with_errors', () => {
    const s = setup({ definition: '{"id": "string"}' });
    const { out } = s.fire({ payload: {} });
    expect(out[0]).toBeNull();
    expect(out[1]).not.toBeNull();
    const errors = (out[1] as NodeMessage).errors as string[];
    expect(errors).toContain('id: missing required field');
  });

  it('test_schema_routes_wrong_type_to_port_one', () => {
    const s = setup({ definition: '{"amount": "number"}' });
    const { out } = s.fire({ payload: { amount: 'not-a-number' } });
    expect(out[0]).toBeNull();
    const errors = (out[1] as NodeMessage).errors as string[];
    expect(errors).toContain('amount: expected finite number');
  });

  it('test_schema_aggregates_every_defect', () => {
    const s = setup({ definition: '{"id": "string", "amount": "number", "ok": "boolean"}' });
    const { out } = s.fire({ payload: { id: 1, amount: 'x', ok: 'maybe' } });
    const errors = (out[1] as NodeMessage).errors as string[];
    expect(errors).toEqual(expect.arrayContaining([
      'id: expected string',
      'amount: expected finite number',
      'ok: expected boolean',
    ]));
  });

  it('test_schema_integer_rejects_floats', () => {
    const s = setup({ definition: '{"n": "integer"}' });
    expect(((s.fire({ payload: { n: 3.5 } }).out[1]) as NodeMessage).errors).toBeDefined();
    expect(((s.fire({ payload: { n: 3 } }).out[0]) as NodeMessage).payload).toEqual({ n: 3 });
  });

  it('test_schema_array_and_object_and_null_tags', () => {
    const s = setup({ definition: '{"a": "array", "o": "object", "z": "null"}' });
    const ok = s.fire({ payload: { a: [1, 2], o: { x: 1 }, z: null } });
    expect(ok.out[0]).not.toBeNull();
    expect(ok.out[1]).toBeNull();
    const bad = s.fire({ payload: { a: 'nope', o: [], z: 'not-null' } });
    const errors = (bad.out[1] as NodeMessage).errors as string[];
    expect(errors).toContain('a: expected array');
    expect(errors).toContain('o: expected object');
    expect(errors).toContain('z: expected null');
  });

  it('test_schema_any_type_skips_checking', () => {
    const s = setup({ definition: '{"thing": "any"}' });
    expect(s.fire({ payload: { thing: 42 } }).out[0]).not.toBeNull();
    expect(s.fire({ payload: { thing: 'hi' } }).out[0]).not.toBeNull();
    expect(s.fire({ payload: { thing: null } }).out[0]).not.toBeNull();
  });
});

describe('schema — optional fields', () => {
  it('test_schema_optional_field_may_be_absent', () => {
    const s = setup({ definition: '{"id": "string", "memo?": "string"}' });
    const { out } = s.fire({ payload: { id: 'x' } });
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
  });

  it('test_schema_optional_field_still_type_checked_when_present', () => {
    const s = setup({ definition: '{"id": "string", "memo?": "string"}' });
    const { out } = s.fire({ payload: { id: 'x', memo: 42 } });
    expect(out[0]).toBeNull();
    expect((out[1] as NodeMessage).errors).toEqual(['memo: expected string']);
  });
});

describe('schema — strict mode', () => {
  it('test_schema_non_strict_ignores_extra_fields_by_default', () => {
    const s = setup({ definition: '{"id": "string"}' });
    const { out } = s.fire({ payload: { id: 'x', extra: 99 } });
    expect(out[0]).not.toBeNull();
  });

  it('test_schema_strict_rejects_undeclared_fields', () => {
    const s = setup({ definition: '{"id": "string"}', strict: true });
    const { out } = s.fire({ payload: { id: 'x', extra: 99 } });
    expect(out[0]).toBeNull();
    expect((out[1] as NodeMessage).errors).toContain('extra: not declared in schema (strict mode)');
  });
});

describe('schema — target field selection', () => {
  it('test_schema_validates_alternate_target_field', () => {
    const s = setup({ definition: '{"id": "string"}', target: 'tuple' });
    const okMsg: NodeMessage = { payload: 'ignored', tuple: { id: 'x' } };
    expect(s.fire(okMsg).out[0]).not.toBeNull();
    const badMsg: NodeMessage = { payload: 'ignored', tuple: { id: 42 } };
    expect((s.fire(badMsg).out[1] as NodeMessage).errors).toContain('id: expected string');
  });
});

describe('schema — non-object payloads', () => {
  it('test_schema_routes_non_object_target_to_port_one', () => {
    const s = setup({ definition: '{"id": "string"}' });
    const { out } = s.fire({ payload: 'just a string' });
    expect(out[0]).toBeNull();
    expect((out[1] as NodeMessage).errors).toContain('target value is not a JSON object');
  });
});
