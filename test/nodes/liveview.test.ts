/**
 * Tests for the liveview node.
 *
 * Naming: test_liveview_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import liveviewNode, { getLiveViewSnapshot, listLiveViews } from '../../src/server/nodes/liveview.js';
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
    type: 'liveview',
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

  liveviewNode(red);

  return {
    fire: (msg) => {
      if (inputHandler) inputHandler(msg, null as never, () => {});
      return { outputs: [...outputs], errors: [...errors] };
    },
  };
}

describe('liveview — append mode', () => {
  it('test_liveview_appends_messages_to_view', () => {
    const { fire } = setup({ viewName: 'orders', keyField: '' });
    fire({ payload: { id: '1', total: 100 } });
    fire({ payload: { id: '2', total: 200 } });
    expect(getLiveViewSnapshot('orders')).toHaveLength(2);
  });

  it('test_liveview_passes_through_unchanged', () => {
    const { fire } = setup({ viewName: 'orders', keyField: '' });
    const r = fire({ payload: { id: '1' } });
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0]).toMatchObject({ payload: { id: '1' } });
  });
});

describe('liveview — upsert mode', () => {
  it('test_liveview_upserts_by_key', () => {
    const { fire } = setup({ viewName: 'users', keyField: 'email' });
    fire({ email: 'a@b.com', payload: { name: 'Alice' } });
    fire({ email: 'a@b.com', payload: { name: 'Alicia' } });
    const snap = getLiveViewSnapshot('users');
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ email: 'a@b.com', payload: { name: 'Alicia' } });
  });
});

describe('liveview — registry', () => {
  it('test_liveview_lists_views', () => {
    setup({ viewName: 'alpha', keyField: '' }).fire({ payload: 1 });
    setup({ viewName: 'beta', keyField: '' }).fire({ payload: 2 });
    const names = listLiveViews();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });
});
