/**
 * Tests for the map node.
 *
 * Naming: test_map_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import mapNode from '../../src/server/nodes/map.js';
import type { NodeMessage, NodeRED } from '../../src/server/nodes/red-runtime.js';

interface FireResult {
  outputs: NodeMessage[];
}

function setup(config: Record<string, unknown>): { fire: (msg: NodeMessage) => FireResult } {
  let inputHandler: ((msg: NodeMessage, send: never, done: (e?: Error) => void) => void) | null = null;
  const outputs: NodeMessage[] = [];

  const node = {
    id: 'n1',
    type: 'map',
    on: (ev: string, h: unknown) => { if (ev === 'input') inputHandler = h as never; },
    send: (out: unknown) => {
      if (Array.isArray(out)) {
        out.forEach((m: unknown) => { if (m) outputs.push(m as NodeMessage); });
      } else if (out) {
        outputs.push(out as NodeMessage);
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

  mapNode(red);

  return {
    fire: (msg) => {
      outputs.length = 0;
      if (inputHandler) inputHandler(msg, null as never, () => {});
      return { outputs: [...outputs] };
    },
  };
}

describe('map', () => {
  it('test_map_computes_expression_and_assigns_field', () => {
    const { fire } = setup({ rules: '[{"field":"total","expression":"msg.payload.price * msg.payload.qty"}]' });
    const r = fire({ payload: { price: 10, qty: 3 } });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({ payload: { price: 10, qty: 3 }, total: 30 });
  });

  it('test_map_applies_multiple_rules', () => {
    const { fire } = setup({
      rules: '[{"field":"discounted","expression":"msg.payload.price * 0.9"},{"field":"label","expression":"\\"item-\\" + msg.payload.id"}]',
    });
    const r = fire({ payload: { id: 'abc', price: 100 } });
    expect(r.outputs[0]).toMatchObject({
      payload: { id: 'abc', price: 100 },
      discounted: 90,
      label: 'item-abc',
    });
  });

  it('test_map_bad_rules_aborts', () => {
    const { fire } = setup({ rules: 'not-json' });
    expect(() => fire({ payload: 1 })).not.toThrow();
  });
});
