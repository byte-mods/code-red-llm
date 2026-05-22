/**
 * Tests for the simulation engine.
 */
import { describe, expect, it } from 'vitest';

import { simulateFlow } from '../../src/server/simulator/index.js';
import type { SimNode } from '../../src/server/simulator/types.js';

function makeNode(p: Partial<SimNode> & { id: string; type: string }): SimNode {
  return {
    id: p.id,
    type: p.type,
    wires: p.wires ?? [],
    ...p,
  };
}

describe('simulateFlow — happy path', () => {
  it('test_simulate_single_inject_passes_through', async () => {
    const result = await simulateFlow([makeNode({ id: 'a', type: 'inject' })], 'a', { payload: 'hello' });
    expect(result.ok).toBe(true);
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]!.output.payload).toBe('hello');
  });

  it('test_simulate_chain_transforms_message', async () => {
    const nodes = [
      makeNode({ id: 'a', type: 'inject', wires: [['b']] }),
      makeNode({ id: 'b', type: 'debug', wires: [['c']] }),
      makeNode({ id: 'c', type: 'debug' }),
    ];
    const result = await simulateFlow(nodes, 'a', { payload: 1 });
    expect(result.ok).toBe(true);
    expect(result.trace).toHaveLength(3);
    expect(result.trace.map((t) => t.nodeId)).toEqual(['a', 'b', 'c']);
  });

  it('test_simulate_function_node_transforms_payload', async () => {
    const nodes = [
      makeNode({ id: 'a', type: 'inject', wires: [['b']] }),
      makeNode({ id: 'b', type: 'function', func: 'msg.payload = msg.payload + 1; return msg;', wires: [['c']] }),
      makeNode({ id: 'c', type: 'debug' }),
    ];
    const result = await simulateFlow(nodes, 'a', { payload: 5 });
    expect(result.ok).toBe(true);
    const funcOut = result.trace.find((t) => t.nodeId === 'b');
    expect(funcOut!.output.payload).toBe(6);
  });

  it('test_simulate_http_request_returns_mock', async () => {
    const nodes = [makeNode({ id: 'a', type: 'http request', url: 'https://example.com/api', wires: [] })];
    const result = await simulateFlow(nodes, 'a', { payload: {} });
    expect(result.ok).toBe(true);
    expect(result.trace[0]!.output.payload).toMatchObject({ statusCode: 200, body: { mock: true } });
  });

  it('test_simulate_postgres_returns_mock_rows', async () => {
    const nodes = [makeNode({ id: 'a', type: 'postgres', wires: [] })];
    const result = await simulateFlow(nodes, 'a', { payload: {} });
    expect(result.ok).toBe(true);
    expect(result.trace[0]!.output.payload).toMatchObject({ rows: [], rowCount: 0 });
  });
});

describe('simulateFlow — edge cases', () => {
  it('test_simulate_missing_start_node_returns_error', async () => {
    const result = await simulateFlow([], 'x', { payload: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('test_simulate_cycle_detected', async () => {
    const nodes = [
      makeNode({ id: 'a', type: 'inject', wires: [['b']] }),
      makeNode({ id: 'b', type: 'debug', wires: [['a']] }),
    ];
    const result = await simulateFlow(nodes, 'a', { payload: {} });
    expect(result.ok).toBe(true);
    expect(result.trace.some((t) => t.detail === 'cycle detected — branch terminated')).toBe(true);
  });

  it('test_simulate_fanout_enqueues_all_branches', async () => {
    const nodes = [
      makeNode({ id: 'a', type: 'inject', wires: [['b', 'c']] }),
      makeNode({ id: 'b', type: 'debug' }),
      makeNode({ id: 'c', type: 'debug' }),
    ];
    const result = await simulateFlow(nodes, 'a', { payload: {} });
    expect(result.ok).toBe(true);
    expect(result.trace.map((t) => t.nodeId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('test_simulate_max_steps_hits_limit', async () => {
    const nodes: SimNode[] = [];
    for (let i = 0; i < 120; i++) {
      nodes.push(makeNode({ id: `n${i}`, type: 'debug', wires: [[`n${i + 1}`]] }));
    }
    const result = await simulateFlow(nodes, 'n0', { payload: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('exceeded');
  });

  it('test_simulate_function_error_captured_in_trace', async () => {
    const nodes = [
      makeNode({ id: 'a', type: 'function', func: 'throw new Error("boom");', wires: [] }),
    ];
    const result = await simulateFlow(nodes, 'a', { payload: {} });
    expect(result.ok).toBe(true);
    expect(result.trace[0]!.status).toBe('error');
    expect(result.trace[0]!.detail).toContain('boom');
  });
});
