/**
 * Tests for the feed-sim node.
 *
 * Naming: test_feedSim_<scenario>_<expected_behavior>
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import feedSimNode from '../../src/server/nodes/feed-sim.js';
import type { NodeInstance, NodeMessage, NodeRED } from '../../src/server/nodes/red-runtime.js';

interface FireResult {
  outputs: NodeMessage[];
  statuses: Array<Record<string, unknown>>;
}

function setup(config: Record<string, unknown>): { outputs: NodeMessage[]; close: () => void } {
  const outputs: NodeMessage[] = [];
  const statuses: Array<Record<string, unknown>> = [];

  const node = {
    id: 'n1',
    type: 'feed-sim',
    on: () => {},
    send: (out: unknown) => {
      if (Array.isArray(out)) {
        out.forEach((m: unknown) => { if (m) outputs.push(m as NodeMessage); });
      } else if (out) {
        outputs.push(out as NodeMessage);
      }
    },
    status: (s: unknown) => { statuses.push(s as Record<string, unknown>); },
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

  feedSimNode(red);

  return {
    outputs,
    close: () => {
      // Trigger close handler if registered
      // The node registers on('close', ...) but our mock node.on is a no-op,
      // so we can't easily call the close handler. For tests we rely on
      // vitest fake timers and the interval being cleaned up when tests end.
    },
  };
}

describe('feed-sim', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('test_feedSim_emits_synthetic_payload_on_interval', () => {
    const { outputs } = setup({ schema: '{"id":"string","temp":"number"}', interval: 500, count: 2, topic: 'sensors' });
    vi.advanceTimersByTime(500);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ topic: 'sensors' });
    const p = (outputs[0] as { payload: Record<string, unknown> }).payload;
    expect(typeof p['id']).toBe('string');
    expect(typeof p['temp']).toBe('number');

    vi.advanceTimersByTime(500);
    expect(outputs).toHaveLength(2);

    vi.advanceTimersByTime(500);
    expect(outputs).toHaveLength(2); // count limit reached
  });

  it('test_feedSim_infinite_mode_keeps_emitting', () => {
    const { outputs } = setup({ schema: '{"x":"integer"}', interval: 100, count: 0 });
    vi.advanceTimersByTime(1000);
    expect(outputs.length).toBeGreaterThanOrEqual(5);
  });

  it('test_feedSim_bad_schema_aborts', () => {
    const { outputs } = setup({ schema: 'not-json', interval: 100, count: 1 });
    vi.advanceTimersByTime(200);
    expect(outputs).toHaveLength(0);
  });
});
