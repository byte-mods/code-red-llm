/**
 * Tests for the tracer bus — the singleton that mediates between
 * tracer node instances and the admin / sidebar control surface.
 *
 * The bus is a process singleton; tests must unregister cleanly so
 * cross-test state never leaks. Each test uses a unique tracer id.
 */
import { describe, expect, it, afterEach } from 'vitest';

import { tracerBus } from '../../src/server/tracer/bus.js';

const created: string[] = [];

afterEach(() => {
  for (const id of created.splice(0)) tracerBus.unregister(id);
});

function registerOne(id: string, mode: 'running' | 'paused' = 'running'): { released: unknown[] } {
  const released: unknown[] = [];
  tracerBus.register(id, undefined, mode, (m) => released.push(m));
  created.push(id);
  return { released };
}

describe('tracerBus — pass-through (running mode)', () => {
  it('test_bus_ingest_returns_true_in_running_mode', () => {
    registerOne('t-run-1', 'running');
    expect(tracerBus.ingest('t-run-1', { payload: 'a' })).toBe(true);
    const snap = tracerBus.snapshot('t-run-1');
    expect(snap?.heldCount).toBe(0);
    expect(snap?.seenCount).toBe(1);
  });

  it('test_bus_unknown_id_ingest_fails_open', () => {
    expect(tracerBus.ingest('does-not-exist', { payload: 1 })).toBe(true);
  });
});

describe('tracerBus — hold + step + resume (paused mode)', () => {
  it('test_bus_ingest_returns_false_when_paused_and_holds_msg', () => {
    const { released } = registerOne('t-hold-1', 'paused');
    expect(tracerBus.ingest('t-hold-1', { payload: 'a' })).toBe(false);
    expect(tracerBus.ingest('t-hold-1', { payload: 'b' })).toBe(false);
    expect(released).toEqual([]);
    expect(tracerBus.snapshot('t-hold-1')?.heldCount).toBe(2);
  });

  it('test_bus_step_releases_one_held_in_fifo_order', () => {
    const { released } = registerOne('t-step-1', 'paused');
    tracerBus.ingest('t-step-1', { payload: 'a' });
    tracerBus.ingest('t-step-1', { payload: 'b' });
    expect(tracerBus.step('t-step-1')).toBe(true);
    expect(released).toEqual([{ payload: 'a' }]);
    expect(tracerBus.snapshot('t-step-1')?.heldCount).toBe(1);
  });

  it('test_bus_step_returns_false_when_nothing_held', () => {
    registerOne('t-step-empty', 'paused');
    expect(tracerBus.step('t-step-empty')).toBe(false);
  });

  it('test_bus_resume_drains_all_held_in_order_and_switches_mode', () => {
    const { released } = registerOne('t-resume-1', 'paused');
    tracerBus.ingest('t-resume-1', { payload: 'a' });
    tracerBus.ingest('t-resume-1', { payload: 'b' });
    tracerBus.ingest('t-resume-1', { payload: 'c' });
    tracerBus.resume('t-resume-1');
    expect(released).toEqual([{ payload: 'a' }, { payload: 'b' }, { payload: 'c' }]);
    const snap = tracerBus.snapshot('t-resume-1');
    expect(snap?.mode).toBe('running');
    expect(snap?.heldCount).toBe(0);
  });

  it('test_bus_pause_during_traffic_starts_holding_subsequent_msgs', () => {
    const { released } = registerOne('t-pause-mid', 'running');
    tracerBus.ingest('t-pause-mid', { payload: 'before-pause' });
    tracerBus.pause('t-pause-mid');
    tracerBus.ingest('t-pause-mid', { payload: 'after-pause' });
    // pass-through msgs aren't routed via releaseHook — only the node's
    // own `send` would have fired them. Bus only releases what it held.
    expect(released).toEqual([]);
    expect(tracerBus.snapshot('t-pause-mid')?.heldCount).toBe(1);
  });
});

describe('tracerBus — events', () => {
  it('test_bus_emits_changed_on_each_mutation', () => {
    const events: string[] = [];
    const listener = (s: { id: string }): void => { events.push(s.id); };
    tracerBus.on('changed', listener);
    try {
      registerOne('t-ev-1', 'paused');
      tracerBus.ingest('t-ev-1', { payload: 'a' });
      tracerBus.step('t-ev-1');
      expect(events).toContain('t-ev-1');
      expect(events.length).toBeGreaterThanOrEqual(2);
    } finally {
      tracerBus.off('changed', listener);
    }
  });
});

describe('tracerBus — recent log bounding', () => {
  it('test_bus_recent_log_is_bounded', () => {
    registerOne('t-recent', 'running');
    for (let i = 0; i < 80; i++) tracerBus.ingest('t-recent', { payload: i });
    const snap = tracerBus.snapshot('t-recent');
    expect(snap?.recent.length).toBeLessThanOrEqual(50);
    // Should be the most recent 50.
    expect(snap?.recent[snap.recent.length - 1]?.preview).toBe('79');
  });
});

describe('tracerBus — list / snapshot', () => {
  it('test_bus_list_returns_all_registered', () => {
    registerOne('t-list-1');
    registerOne('t-list-2');
    const list = tracerBus.list();
    const ids = list.map((s) => s.id);
    expect(ids).toContain('t-list-1');
    expect(ids).toContain('t-list-2');
  });

  it('test_bus_unregister_removes_from_list', () => {
    registerOne('t-unreg-1');
    expect(tracerBus.snapshot('t-unreg-1')).toBeDefined();
    tracerBus.unregister('t-unreg-1');
    created.splice(created.indexOf('t-unreg-1'), 1);
    expect(tracerBus.snapshot('t-unreg-1')).toBeUndefined();
  });
});
