/**
 * Tests for the table-join node.
 *
 * Naming: test_tableJoin_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import tableJoinNode from '../../src/server/nodes/table-join.js';
import queryTableNode from '../../src/server/nodes/query-table.js';
import type { NodeInstance, NodeMessage, NodeRED } from '../../src/server/nodes/red-runtime.js';

interface FireResult {
  outputs: NodeMessage[];
  errors: Error[];
}

function makeNode(type: string, config: Record<string, unknown>): { fire: (msg: NodeMessage) => FireResult } {
  let inputHandler: ((msg: NodeMessage, send: never, done: (e?: Error) => void) => void) | null = null;
  const outputs: NodeMessage[] = [];
  const errors: Error[] = [];

  const node = {
    id: 'n1',
    type,
    on: (ev: string, h: unknown) => { if (ev === 'input') inputHandler = h as never; },
    send: (out: unknown) => {
      if (Array.isArray(out)) {
        out.forEach((m: unknown) => { if (m) outputs.push(m as NodeMessage); });
      } else if (out) {
        outputs.push(out as NodeMessage);
      }
    },
    status: () => {},
    error: (e: unknown) => { errors.push(e instanceof Error ? e : new Error(String(e))); },
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

  if (type === 'table-join') tableJoinNode(red);
  else queryTableNode(red);

  return {
    fire: (msg) => {
      if (inputHandler) inputHandler(msg, null as never, () => {});
      return { outputs: [...outputs], errors: [...errors] };
    },
  };
}

describe('table-join', () => {
  it('test_tableJoin_enriches_msg_with_table_record', () => {
    const write = makeNode('query-table', { tableName: 'products', primaryKey: 'sku', operation: 'write' });
    write.fire({ payload: { sku: 'abc', name: 'widget', price: 9.99 } });

    const join = makeNode('table-join', { tableName: 'products', keyField: 'sku', outputField: 'product' });
    const r = join.fire({ sku: 'abc', payload: { qty: 2 } });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({
      payload: { qty: 2 },
      product: { sku: 'abc', name: 'widget', price: 9.99 },
    });
  });

  it('test_tableJoin_returns_null_when_key_not_found', () => {
    const join = makeNode('table-join', { tableName: 'products', keyField: 'sku', outputField: 'product' });
    const r = join.fire({ sku: 'missing', payload: { qty: 1 } });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({
      payload: { qty: 1 },
      product: null,
    });
  });

  it('test_tableJoin_returns_null_when_key_is_empty', () => {
    const join = makeNode('table-join', { tableName: 'products', keyField: 'sku', outputField: 'product' });
    const r = join.fire({ sku: '', payload: { qty: 1 } });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({
      product: null,
    });
  });
});
