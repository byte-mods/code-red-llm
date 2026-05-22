/**
 * Tests for GenerationRegistry. The registry holds ClaudeSession refs;
 * we mint fake sessions that record `cancel()` invocations so we can
 * assert the registry forwards correctly without spawning subprocesses.
 *
 * Naming: test_registry_<scenario>_<expected_behavior>.
 */
import { describe, expect, it } from 'vitest';

import { GenerationRegistry } from '../../src/server/session/index.js';
import type { ClaudeSession, CancelReason } from '../../src/server/claude/index.js';

interface FakeSession extends ClaudeSession {
  cancelled: Array<string | undefined>;
}

function fakeSession(): FakeSession {
  const cancelled: Array<string | undefined> = [];
  return {
    events: (async function* () { /* empty */ })(),
    done: Promise.resolve({ exitCode: 0, signal: null, wasCancelled: false }),
    stderr: () => '',
    stats: () => ({ eventsEmitted: 0, parseErrors: 0, linesSeen: 0 }),
    pid: 12345,
    cancel: (reason?: CancelReason) => { cancelled.push(reason); },
    cancelled,
  } as unknown as FakeSession;
}

function entry(id: string, session: FakeSession) {
  return { id, prompt: 'p', flowId: undefined, model: undefined, startedAt: Date.now(), session };
}

describe('GenerationRegistry — capacity', () => {
  it('test_registry_tryAcquire_succeeds_under_cap', () => {
    const r = new GenerationRegistry({ maxConcurrent: 2 });
    expect(r.tryAcquire()).toBe(true);
    r.register(entry('a', fakeSession()));
    expect(r.tryAcquire()).toBe(true);
    r.register(entry('b', fakeSession()));
    expect(r.tryAcquire()).toBe(false);
  });

  it('test_registry_remove_frees_a_slot', () => {
    const r = new GenerationRegistry({ maxConcurrent: 1 });
    r.register(entry('a', fakeSession()));
    expect(r.tryAcquire()).toBe(false);
    r.remove('a');
    expect(r.tryAcquire()).toBe(true);
  });
});

describe('GenerationRegistry — listing', () => {
  it('test_registry_list_returns_all_entries', () => {
    const r = new GenerationRegistry({ maxConcurrent: 5 });
    r.register(entry('a', fakeSession()));
    r.register(entry('b', fakeSession()));
    const list = r.list();
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    expect(list[0]?.pid).toBe(12345);
  });

  it('test_registry_size_tracks_entries', () => {
    const r = new GenerationRegistry();
    expect(r.size()).toBe(0);
    r.register(entry('a', fakeSession()));
    expect(r.size()).toBe(1);
    r.remove('a');
    expect(r.size()).toBe(0);
  });
});

describe('GenerationRegistry — cancellation', () => {
  it('test_registry_cancel_invokes_session_cancel', () => {
    const r = new GenerationRegistry();
    const s = fakeSession();
    r.register(entry('a', s));
    const ok = r.cancel('a', 'user');
    expect(ok).toBe(true);
    expect(s.cancelled).toEqual(['user']);
  });

  it('test_registry_cancel_returns_false_for_unknown_id', () => {
    const r = new GenerationRegistry();
    expect(r.cancel('nope')).toBe(false);
  });

  it('test_registry_cancelAll_cancels_every_entry_with_shutdown_reason', () => {
    const r = new GenerationRegistry();
    const s1 = fakeSession();
    const s2 = fakeSession();
    r.register(entry('a', s1));
    r.register(entry('b', s2));
    r.cancelAll();
    expect(s1.cancelled).toEqual(['shutdown']);
    expect(s2.cancelled).toEqual(['shutdown']);
  });

  it('test_registry_duplicate_id_throws', () => {
    const r = new GenerationRegistry();
    r.register(entry('a', fakeSession()));
    expect(() => r.register(entry('a', fakeSession()))).toThrow(/duplicate/);
  });
});
