/**
 * Tests for the filter node.
 *
 * Naming: test_filter_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import filterNode from '../../src/server/nodes/filter.js';
import type { NodeMessage, NodeRED } from '../../src/server/nodes/red-runtime.js';

interface FireResult {
  outputs: (NodeMessage | null)[];
}

function setup(config: Record<string, unknown>): { fire: (msg: NodeMessage) => FireResult } {
  let inputHandler: ((msg: NodeMessage, send: never, done: (e?: Error) => void) => void) | null = null;
  let lastOutputs: (NodeMessage | null)[] = [];

  const node = {
    id: 'n1',
    type: 'filter',
    on: (ev: string, h: unknown) => { if (ev === 'input') inputHandler = h as never; },
    send: (out: unknown) => {
      if (Array.isArray(out)) {
        lastOutputs = out as (NodeMessage | null)[];
      } else {
        lastOutputs = [out as NodeMessage | null];
      }
    },
    status: () => {},
    error: (e: unknown) => { throw e instanceof Error ? e : new Error(String(e)); },
    log: () => {},
    warn: () => {},
  };

  const red: NodeRED = {
    nodes: {
      registerType: (_type: string, ctor: (...args: unknown[]) => void) => { ctor.call(node, config); },
      createNode: () => ({}) as never,
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as NodeRED;

  filterNode(red);

  return {
    fire: (msg) => {
      lastOutputs = [];
      if (inputHandler) inputHandler(msg, null as never, () => {});
      return { outputs: [...lastOutputs] };
    },
  };
}

describe('filter', () => {
  it('test_filter_routes_to_first_matching_port', () => {
    const { fire } = setup({ rules: '["msg.payload.status === \\"active\\"", "msg.payload.status === \\"pending\\""]' });
    const r = fire({ payload: { status: 'pending' } });
    expect(r.outputs).toHaveLength(3);
    expect(r.outputs[0]).toBeNull();
    expect(r.outputs[1]).toMatchObject({ payload: { status: 'pending' } });
    expect(r.outputs[2]).toBeNull();
  });

  it('test_filter_routes_to_catch_all_when_no_match', () => {
    const { fire } = setup({ rules: '["msg.payload.status === \\"active\\""]' });
    const r = fire({ payload: { status: 'deleted' } });
    expect(r.outputs).toHaveLength(2);
    expect(r.outputs[0]).toBeNull();
    expect(r.outputs[1]).toMatchObject({ payload: { status: 'deleted' } });
  });

  it('test_filter_evaluates_numeric_predicates', () => {
    const { fire } = setup({ rules: '["msg.payload.temp > 100", "msg.payload.temp > 50"]' });
    const r = fire({ payload: { temp: 75 } });
    expect(r.outputs[0]).toBeNull();
    expect(r.outputs[1]).toMatchObject({ payload: { temp: 75 } });
  });

  it('test_filter_bad_rules_aborts', () => {
    const { fire } = setup({ rules: 'not-json' });
    expect(() => fire({ payload: 1 })).not.toThrow();
  });
});
