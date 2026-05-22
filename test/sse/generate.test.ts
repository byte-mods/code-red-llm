/**
 * Integration tests for the generate route handler.
 *
 * Strategy: point CLAUDE_BIN at the fake-claude shell wrapper that the
 * spawn tests already use, invoke `handleGenerate` directly with hand-
 * built fake Request + Response objects, and assert the SSE frames that
 * land. This exercises the full bridge → extractor → SSE pipeline end-
 * to-end without an HTTP listener.
 *
 * The fake fixture must contain an assistant event with text that includes
 * a `<NODE>...</NODE>` block so the extractor has something to yield.
 *
 * Naming: test_generateRoute_<scenario>_<expected_behavior>.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

import { handleGenerate } from '../../src/server/sse/index.js';
import { SENTINEL_OPEN, SENTINEL_CLOSE } from '../../src/server/prompt/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '../..');
const fakeBin = resolve(repoRoot, 'scripts/fake-claude.mjs');

/**
 * Craft a fake claude transcript that contains one valid node block.
 * The validator-required fields are present so the extractor emits a
 * `node` (not an `error`) frame.
 */
function makeNodeFixture(): string {
  const nodeJson = '{"id":"n1","type":"inject","x":100,"y":100,"wires":[["n2"]]}';
  const text = `here's the inject node:\n${SENTINEL_OPEN}${nodeJson}${SENTINEL_CLOSE}`;
  // Real stream-json wraps content under `message`, matching the CLI's
  // wire format — see test/fixtures/claude-stream-success.jsonl.
  const assistant = {
    type: 'assistant',
    message: {
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    },
    session_id: 's',
  };
  const result = {
    type: 'result',
    subtype: 'success',
    session_id: 's',
    is_error: false,
  };
  return JSON.stringify(assistant) + '\n' + JSON.stringify(result) + '\n';
}

/**
 * Build the shell wrapper that points spawnClaude's `claudeBin` (or
 * CLAUDE_BIN env, here we set the env for the duration of one test) at
 * the fake script + a fixture. Returns the wrapper path.
 */
function makeWrapper(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gen-test-'));
  const fixturePath = join(dir, 'fixture.jsonl');
  writeFileSync(fixturePath, makeNodeFixture());
  const wrapper = join(dir, 'wrapper.sh');
  writeFileSync(wrapper, `#!/usr/bin/env bash\nexec node ${fakeBin} ${fixturePath}\n`);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

/**
 * Fake Express Response that captures every frame the SSE writer emits.
 * The route's lifecycle (writeHead → write loop → end) is observable
 * through `.writes`, `.headers`, and `.ended`.
 */
function makeFakeResponse() {
  const r: {
    writes: string[];
    ended: boolean;
    headerStatus: number | null;
    headers: Record<string, string> | null;
    statusCode: number;
    closeListener?: () => void;
    writeHead: (s: number, h: Record<string, string>) => void;
    flushHeaders: () => void;
    write: (c: string) => void;
    end: () => void;
    on: (e: string, fn: () => void) => void;
    status: (s: number) => typeof r;
    json: (body: unknown) => void;
    jsonBody?: unknown;
  } = {
    writes: [],
    ended: false,
    headerStatus: null,
    headers: null,
    statusCode: 200,
    writeHead(s, h) {
      this.headerStatus = s;
      this.headers = { ...h };
    },
    flushHeaders() {},
    write(c) {
      this.writes.push(c);
    },
    end() {
      this.ended = true;
    },
    on(e, fn) {
      if (e === 'close') this.closeListener = fn;
    },
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      this.ended = true;
    },
  };
  return r;
}

/**
 * Fake Express Request — an EventEmitter (so `req.on('close', ...)` works)
 * with a `.query` map.
 */
function makeFakeRequest(
  query: Record<string, string>,
  ip: string = `127.0.0.${Math.floor(Math.random() * 250) + 1}`,
): EventEmitter & { query: Record<string, string>; ip: string } {
  const r = new EventEmitter() as EventEmitter & { query: Record<string, string>; ip: string };
  r.query = query;
  r.ip = ip;
  return r;
}

/** Parse the captured `writes` array into a list of SSE events. */
function parseFrames(writes: string[]): Array<{ event: string; data: unknown }> {
  const text = writes.join('');
  const frames = text.split('\n\n').filter((f) => f.length > 0);
  return frames.map((frame) => {
    const lines = frame.split('\n');
    let name = '';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event: ')) name = line.slice(7);
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      // comment frames (`: ping`) are filtered by the data-line collection
    }
    if (name === '' && dataLines.length === 0) {
      return { event: ':comment', data: null };
    }
    const joined = dataLines.join('\n');
    let data: unknown = null;
    if (joined !== '') {
      try {
        data = JSON.parse(joined);
      } catch {
        data = joined;
      }
    }
    return { event: name, data };
  });
}

describe('generate route — happy path', () => {
  let wrapper: string;

  beforeAll(() => {
    wrapper = makeWrapper();
    process.env['CLAUDE_BIN'] = wrapper;
  });

  it('test_generateRoute_emits_meta_node_done_sequence', async () => {
    const req = makeFakeRequest({ prompt: 'build a flow' });
    const res = makeFakeResponse();
    // The handler signature is (req, res) — our fakes are duck-typed.
    await handleGenerate(
      req as unknown as Parameters<typeof handleGenerate>[0],
      res as unknown as Parameters<typeof handleGenerate>[1],
    );

    const frames = parseFrames(res.writes);
    const names = frames.map((f) => f.event);
    // Must contain at least meta → node → done in order.
    expect(names[0]).toBe('meta');
    expect(names).toContain('node');
    expect(names[names.length - 1]).toBe('done');

    const nodeFrame = frames.find((f) => f.event === 'node');
    expect(nodeFrame).toBeDefined();
    const nodeObj = nodeFrame!.data as { id: string; type: string };
    expect(nodeObj.id).toBe('n1');
    expect(nodeObj.type).toBe('inject');

    expect(res.ended).toBe(true);
    expect(res.headerStatus).toBe(200);
    expect(res.headers).toMatchObject({ 'Content-Type': 'text/event-stream; charset=utf-8' });
  });

  it('test_generateRoute_returns_400_when_prompt_missing', async () => {
    const req = makeFakeRequest({});
    const res = makeFakeResponse();
    await handleGenerate(
      req as unknown as Parameters<typeof handleGenerate>[0],
      res as unknown as Parameters<typeof handleGenerate>[1],
    );
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'query param "prompt" is required' });
    // No SSE frames should have been written.
    expect(res.writes).toEqual([]);
  });

  it('test_generateRoute_returns_413_when_prompt_too_large', async () => {
    // S7.T2: prompts above 8KB are rejected.
    const huge = 'x'.repeat(9 * 1024);
    const req = makeFakeRequest({ prompt: huge });
    const res = makeFakeResponse();
    await handleGenerate(
      req as unknown as Parameters<typeof handleGenerate>[0],
      res as unknown as Parameters<typeof handleGenerate>[1],
    );
    expect(res.statusCode).toBe(413);
    expect(res.writes).toEqual([]);
  });

  it('test_generateRoute_returns_429_on_rapid_repeat_from_same_ip', async () => {
    // S7.T2: per-IP rate limit. Two requests from the same IP within
    // the window — second should be rejected with 429.
    const ip = '203.0.113.99';
    const req1 = makeFakeRequest({ prompt: 'x' }, ip);
    const res1 = makeFakeResponse();
    await handleGenerate(
      req1 as unknown as Parameters<typeof handleGenerate>[0],
      res1 as unknown as Parameters<typeof handleGenerate>[1],
    );
    expect(res1.statusCode).toBe(200);

    const req2 = makeFakeRequest({ prompt: 'y' }, ip);
    const res2 = makeFakeResponse();
    await handleGenerate(
      req2 as unknown as Parameters<typeof handleGenerate>[0],
      res2 as unknown as Parameters<typeof handleGenerate>[1],
    );
    expect(res2.statusCode).toBe(429);
  });

  it('test_generateRoute_done_frame_carries_exit_code', async () => {
    const req = makeFakeRequest({ prompt: 'x' });
    const res = makeFakeResponse();
    await handleGenerate(
      req as unknown as Parameters<typeof handleGenerate>[0],
      res as unknown as Parameters<typeof handleGenerate>[1],
    );
    const frames = parseFrames(res.writes);
    const done = frames.find((f) => f.event === 'done');
    expect(done).toBeDefined();
    const data = done!.data as { exitCode: number | null; wasCancelled: boolean };
    expect(data.exitCode).toBe(0);
    expect(data.wasCancelled).toBe(false);
  });
});
