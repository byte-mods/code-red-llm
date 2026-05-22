/**
 * Tests for the cancel + timeout + AbortSignal contract on `spawnClaude`.
 *
 * Uses the fake binary with `--hang-forever` to simulate a runaway Claude:
 * the fake emits the first event from a fixture, then sleeps indefinitely
 * with stdout open. cancel(), timeout, and abort must all be able to kill
 * such a child within `killGraceMs`.
 *
 * Naming: test_<spawn|cancel|timeout|abort>_<scenario>_<expected_behavior>.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { spawnClaude, type ClaudeSession } from '../../src/server/claude/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '../..');
const fakeBin = resolve(repoRoot, 'scripts/fake-claude.mjs');
const successFixture = resolve(repoRoot, 'test/fixtures/claude-stream-success.jsonl');

function fakeWrapper(extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const wrapper = join(dir, 'wrapper.sh');
  const body = `#!/usr/bin/env bash\nexec node ${fakeBin} ${successFixture} ${extra.join(' ')}\n`;
  writeFileSync(wrapper, body);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

async function collect(session: ClaudeSession): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const ev of session.events) events.push(ev);
  return events;
}

const HANG_OPTS = { killGraceMs: 100 } as const;

describe('cancel — user-initiated', () => {
  it('test_cancel_terminates_hanging_child_and_drains_iterator', async () => {
    const wrapper = fakeWrapper(['--hang-forever']);
    const session = spawnClaude({ prompt: 'p', claudeBin: wrapper, ...HANG_OPTS });
    // Let the first event arrive before cancelling.
    const iter = session.events[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.done).toBe(false);

    session.cancel('user');
    const exit = await session.done;
    expect(exit.wasCancelled).toBe(true);
    expect(exit.cancelReason).toBe('user');
    // SIGTERM or SIGKILL depending on how fast the grace timer fires.
    expect(exit.signal === 'SIGTERM' || exit.signal === 'SIGKILL').toBe(true);
    // Iterator is drained.
    const tail = await iter.next();
    expect(tail.done).toBe(true);
  });

  it('test_cancel_is_idempotent', async () => {
    const wrapper = fakeWrapper(['--hang-forever']);
    const session = spawnClaude({ prompt: 'p', claudeBin: wrapper, ...HANG_OPTS });
    session.cancel('user');
    session.cancel('user');
    session.cancel('user');
    const exit = await session.done;
    expect(exit.wasCancelled).toBe(true);
    expect(exit.cancelReason).toBe('user');
  });

  it('test_cancel_before_first_event_yields_zero_events', async () => {
    const wrapper = fakeWrapper(['--hang-forever']);
    const session = spawnClaude({ prompt: 'p', claudeBin: wrapper, ...HANG_OPTS });
    session.cancel('user');
    const events = await collect(session);
    expect(events).toHaveLength(0);
    const exit = await session.done;
    expect(exit.cancelReason).toBe('user');
  });

  it('test_cancel_after_clean_exit_is_noop', async () => {
    const wrapper = fakeWrapper();
    const session = spawnClaude({ prompt: 'p', claudeBin: wrapper, ...HANG_OPTS });
    await collect(session);
    const exit = await session.done;
    expect(exit.wasCancelled).toBe(false);
    // Should not throw.
    session.cancel('user');
  });
});

describe('cancel — timeout', () => {
  it('test_timeout_terminates_long_running_child', async () => {
    const wrapper = fakeWrapper(['--hang-forever']);
    const session = spawnClaude({
      prompt: 'p',
      claudeBin: wrapper,
      timeoutMs: 150,
      killGraceMs: 50,
    });
    const exit = await session.done;
    expect(exit.wasCancelled).toBe(true);
    expect(exit.cancelReason).toBe('timeout');
  });

  it('test_timeout_does_not_fire_on_quick_exit', async () => {
    const wrapper = fakeWrapper();
    const session = spawnClaude({
      prompt: 'p',
      claudeBin: wrapper,
      timeoutMs: 5000, // long
      killGraceMs: 50,
    });
    await collect(session);
    const exit = await session.done;
    expect(exit.wasCancelled).toBe(false);
    expect(exit.exitCode).toBe(0);
  });
});

describe('cancel — AbortSignal', () => {
  it('test_abort_signal_terminates_running_child', async () => {
    const wrapper = fakeWrapper(['--hang-forever']);
    const ctrl = new AbortController();
    const session = spawnClaude({
      prompt: 'p',
      claudeBin: wrapper,
      signal: ctrl.signal,
      killGraceMs: 50,
    });
    setTimeout(() => ctrl.abort(), 50);
    const exit = await session.done;
    expect(exit.wasCancelled).toBe(true);
    expect(exit.cancelReason).toBe('abort');
  });

  it('test_pre_aborted_signal_kills_immediately', async () => {
    const wrapper = fakeWrapper(['--hang-forever']);
    const ctrl = new AbortController();
    ctrl.abort();
    const session = spawnClaude({
      prompt: 'p',
      claudeBin: wrapper,
      signal: ctrl.signal,
      killGraceMs: 50,
    });
    const exit = await session.done;
    expect(exit.wasCancelled).toBe(true);
    expect(exit.cancelReason).toBe('abort');
  });
});
