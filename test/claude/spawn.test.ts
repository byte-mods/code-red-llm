/**
 * Tests for `src/server/claude/spawn.ts`.
 *
 * Strategy: never invoke the real `claude` binary. Point `claudeBin` at
 * `scripts/fake-claude.mjs` and feed it a fixture path. The fake replays the
 * fixture to stdout, optionally injecting a malformed line or exiting with a
 * configured code, so we can drive every reachable path without auth or
 * network.
 *
 * Cancellation/timeout paths live in spawn.test.ts → S2.T3.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildClaudeArgs,
  spawnClaude,
  type ClaudeSession,
  type SpawnClaudeOptions,
} from '../../src/server/claude/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '../..');
const fakeBin = resolve(repoRoot, 'scripts/fake-claude.mjs');
const successFixture = resolve(repoRoot, 'test/fixtures/claude-stream-success.jsonl');
const errorFixture = resolve(repoRoot, 'test/fixtures/claude-stream-error.jsonl');

/**
 * Build a session whose binary is `node fake-claude.mjs ...`. We trick the
 * spawn module into running the fake by overriding `claudeBin` to point at
 * `node` and stuffing the script + fixture path into `extraArgs`. This way
 * the production argv (`-p <prompt> --output-format stream-json --verbose`)
 * is still appended, then ignored by the fake.
 *
 * Note: because the bridge places its own argv BEFORE extraArgs, we cannot
 * use extraArgs to put the script first. Instead we use `claudeBin: 'node'`
 * and rely on the fake to read the LAST positional we pass via extraArgs.
 * Simpler: wrap `node fake-claude.mjs <fixture>` into a single executable
 * by writing a tiny shell-script wrapper at runtime — see below.
 */
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Materialize a wrapper script that invokes the fake with a chosen fixture
 * and arguments. Returns the absolute path. The wrapper ignores any argv it
 * receives from the bridge (the real `-p <prompt> ...` flow) — the fake only
 * cares about its own fixture path + flags.
 */
function fakeWrapper(fixture: string, extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const wrapper = join(dir, 'wrapper.sh');
  const body = `#!/usr/bin/env bash\nexec node ${fakeBin} ${fixture} ${extra.join(' ')}\n`;
  writeFileSync(wrapper, body);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

/** Drain a session's events into an array. */
async function collect(session: ClaudeSession): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const ev of session.events) events.push(ev);
  return events;
}

const baseOpts = (claudeBin: string): SpawnClaudeOptions => ({
  prompt: 'test prompt',
  claudeBin,
});

describe('buildClaudeArgs — pure argv builder', () => {
  it('test_buildargs_includes_required_flags_for_stream_json', () => {
    const args = buildClaudeArgs({ prompt: 'hello' });
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
  });

  it('test_buildargs_appends_model_when_provided', () => {
    const args = buildClaudeArgs({ prompt: 'p', model: 'haiku' });
    expect(args).toContain('--model');
    expect(args).toContain('haiku');
  });

  it('test_buildargs_appends_extra_args_in_order', () => {
    const args = buildClaudeArgs({ prompt: 'p', extraArgs: ['--bare', '--max-budget-usd', '0.05'] });
    const idxBare = args.indexOf('--bare');
    const idxBudget = args.indexOf('--max-budget-usd');
    expect(idxBare).toBeGreaterThanOrEqual(0);
    expect(idxBudget).toBeGreaterThan(idxBare);
  });
});

describe('spawnClaude — happy path', () => {
  it('test_spawn_emits_events_in_order_from_fake_binary', async () => {
    const wrapper = fakeWrapper(successFixture);
    const session = spawnClaude(baseOpts(wrapper));
    const events = await collect(session);
    const exit = await session.done;
    expect(exit.exitCode).toBe(0);
    expect(events).toHaveLength(5);
    // Order: system → assistant → user → stream_event → result.
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toEqual(['system', 'assistant', 'user', 'stream_event', 'result']);
  });

  it('test_spawn_stats_reflect_emitted_events', async () => {
    const wrapper = fakeWrapper(successFixture);
    const session = spawnClaude(baseOpts(wrapper));
    await collect(session);
    await session.done;
    const s = session.stats();
    expect(s.eventsEmitted).toBe(5);
    expect(s.parseErrors).toBe(0);
    expect(s.linesSeen).toBe(5);
  });

  it('test_spawn_returns_pid_after_start', async () => {
    const wrapper = fakeWrapper(successFixture);
    const session = spawnClaude(baseOpts(wrapper));
    expect(session.pid).toBeGreaterThan(0);
    await collect(session);
    await session.done;
  });

  it('test_spawn_handles_error_fixture_as_event_stream', async () => {
    const wrapper = fakeWrapper(errorFixture);
    const session = spawnClaude(baseOpts(wrapper));
    const events = await collect(session);
    const exit = await session.done;
    expect(exit.exitCode).toBe(0);
    expect(events).toHaveLength(3);
    const result = events[2] as { type: string; is_error: boolean };
    expect(result.type).toBe('result');
    expect(result.is_error).toBe(true);
  });
});

describe('spawnClaude — exit code propagation', () => {
  it('test_spawn_done_resolves_with_nonzero_exit_code', async () => {
    const wrapper = fakeWrapper(successFixture, ['--exit-code', '7']);
    const session = spawnClaude(baseOpts(wrapper));
    await collect(session);
    const exit = await session.done;
    expect(exit.exitCode).toBe(7);
  });
});

describe('spawnClaude — resilience', () => {
  it('test_spawn_iterator_skips_parse_errors_and_counts_them', async () => {
    const wrapper = fakeWrapper(successFixture, ['--malform-after', '2']);
    const errors: string[] = [];
    const session = spawnClaude({
      ...baseOpts(wrapper),
      onParseError: (e) => errors.push(e.kind),
    });
    const events = await collect(session);
    await session.done;
    // One line replaced with garbage; remaining 4 valid lines should parse.
    expect(events).toHaveLength(4);
    expect(errors).toContain('malformed-json');
    const stats = session.stats();
    expect(stats.parseErrors).toBe(1);
    expect(stats.eventsEmitted).toBe(4);
    expect(stats.linesSeen).toBe(5);
  });

  it('test_spawn_done_rejects_when_binary_missing', async () => {
    const session = spawnClaude({
      prompt: 'p',
      claudeBin: '/nonexistent/path/to/binary/zzz',
    });
    await expect(session.done).rejects.toThrow();
    // Iterator should also terminate cleanly (zero events).
    const events = await collect(session);
    expect(events).toHaveLength(0);
  });

  it('test_spawn_stderr_is_captured', async () => {
    const wrapper = fakeWrapper(successFixture, ['--echo-argv']);
    const session = spawnClaude(baseOpts(wrapper));
    await collect(session);
    await session.done;
    expect(session.stderr()).toContain('ARGV=');
  });
});
