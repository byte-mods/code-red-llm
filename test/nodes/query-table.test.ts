/**
 * Tests for the query-table node.
 *
 * Naming: test_queryTable_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import queryTableNode from '../../src/server/nodes/query-table.js';
import type { NodeInstance, NodeMessage, NodeRED } from '../../src/server/nodes/red-runtime.js';

interface FireResult {
  outputs: NodeMessage[];
  errors: Error[];
}

function setup(config: Record<string, unknown>): { fire: (msg: NodeMessage) => FireResult } {
  let inputHandler: ((msg: NodeMessage, send: never, done: (e?: Error) => void) => void) | null = null;
  const outputs: NodeMessage[] = [];
  const errors: Error[] = [];

  const node = {
    id: 'n1',
    type: 'query-table',
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

  queryTableNode(red);

  return {
    fire: (msg) => {
      if (inputHandler) inputHandler(msg, null as never, () => {});
      return { outputs: [...outputs], errors: [...errors] };
    },
  };
}

describe('query-table — write', () => {
  it('test_queryTable_write_stores_record', () => {
    const { fire } = setup({ tableName: 'orders', primaryKey: 'id', operation: 'write' });
    const r = fire({ payload: { id: '1', total: 100 } });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({ payload: { id: '1', total: 100 } });
    expect(r.errors).toHaveLength(0);
  });

  it('test_queryTable_write_missing_primaryKey_errors', () => {
    const { fire } = setup({ tableName: 'orders', primaryKey: 'id', operation: 'write' });
    const r = fire({ payload: { total: 100 } });
    expect(r.outputs).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });

  it('test_queryTable_write_non_object_payload_errors', () => {
    const { fire } = setup({ tableName: 'orders', primaryKey: 'id', operation: 'write' });
    const r = fire({ payload: 'not-an-object' });
    expect(r.outputs).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });
});

describe('query-table — read', () => {
  it('test_queryTable_read_returns_stored_record', () => {
    const writeNode = setup({ tableName: 'items', primaryKey: 'sku', operation: 'write' });
    writeNode.fire({ payload: { sku: 'abc', name: 'widget' } });

    const readNode = setup({ tableName: 'items', primaryKey: 'sku', operation: 'read' });
    const r = readNode.fire({ payload: 'abc' });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({ payload: { sku: 'abc', name: 'widget' } });
  });

  it('test_queryTable_read_missing_key_returns_null', () => {
    const { fire } = setup({ tableName: 'items', primaryKey: 'sku', operation: 'read' });
    const r = fire({ payload: 'missing' });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({ payload: null });
  });
});

describe('query-table — delete', () => {
  it('test_queryTable_delete_removes_record', () => {
    const writeNode = setup({ tableName: 'users', primaryKey: 'email', operation: 'write' });
    writeNode.fire({ payload: { email: 'a@b.com', name: 'Alice' } });

    const deleteNode = setup({ tableName: 'users', primaryKey: 'email', operation: 'delete' });
    const d = deleteNode.fire({ payload: 'a@b.com' });
    expect(d.outputs).toHaveLength(1);
    expect(d.outputs[0]).toMatchObject({ payload: null });

    const readNode = setup({ tableName: 'users', primaryKey: 'email', operation: 'read' });
    const r = readNode.fire({ payload: 'a@b.com' });
    expect(r.outputs[0]).toMatchObject({ payload: null });
  });
});
