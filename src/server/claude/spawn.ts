/**
 * Subprocess bridge: turn a `claude` CLI invocation into an
 * `AsyncIterable<ClaudeEvent>` plus a `done` promise.
 *
 * S2.T2 scope:
 *  - Spawn the binary with the right argv (-p prompt --output-format
 *    stream-json --verbose --bare).
 *  - Line-buffer stdout via `node:readline` and parse each line.
 *  - Yield successfully-parsed events; skip null events (whitespace) and
 *    silently count parse errors. Mid-stream malformed JSON should not kill
 *    the generation — surface counters via the session for diagnostics.
 *  - Resolve `done` with the exit code/signal when the child closes.
 *  - Reject `done` if the binary cannot be spawned (ENOENT, EACCES, ...).
 *
 * Cancellation, timeout, and richer error events are S2.T3.
 *
 * Design choices:
 *  - Prompt is passed as positional argv (`-p <prompt>`) rather than stdin.
 *    Simpler; argv limit (~128KB on Linux) is fine for our prompts.
 *  - The `claudeBin` option (also CLAUDE_BIN env) lets tests point at the
 *    fake binary at scripts/fake-claude.mjs. Production callers rely on the
 *    default `claude` on PATH.
 *  - `AsyncIterable` is implemented via a tiny pull/push buffer rather than
 *    yielding from readline's async iterator. This lets us start collecting
 *    events before the first consumer attaches (no early-event loss) and
 *    matches the cancellation contract T3 will need.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

import { parseEvent, type ParseError } from './parser.js';
import type { ClaudeEvent } from './events.js';

/** Options controlling subprocess spawn. */
export interface SpawnClaudeOptions {
  /** User prompt — passed as a positional argv after `-p`. Required. */
  readonly prompt: string;
  /** Model alias or full name. Default: leaves choice to the CLI. */
  readonly model?: string;
  /** Extra raw argv appended after the standard set. Useful for `--bare`, `--add-dir`, etc. */
  readonly extraArgs?: readonly string[];
  /** Override the binary path. Defaults to `process.env.CLAUDE_BIN ?? 'claude'`. */
  readonly claudeBin?: string;
  /** Working directory for the child. Defaults to the parent's cwd. */
  readonly cwd?: string;
  /** Environment overrides; merged onto `process.env`. */
  readonly env?: Readonly<Record<string, string>>;
  /** Called on every parse error so callers can log without coupling to a logger. */
  readonly onParseError?: (e: ParseError) => void;
  /**
   * Hard upper bound on the session lifetime. When the deadline elapses the
   * child is SIGTERM'd, then SIGKILL'd after `killGraceMs`. `done` resolves
   * with `cancelReason === 'timeout'`.
   */
  readonly timeoutMs?: number;
  /**
   * Caller-supplied abort signal. Aborting it cancels the session with
   * `cancelReason === 'abort'`. Honored even if it is already aborted at
   * the moment `spawnClaude` is called.
   */
  readonly signal?: AbortSignal;
  /**
   * Milliseconds between SIGTERM and the escalation SIGKILL. Default 2000.
   * Keep low in tests so they do not hang on a hostile child.
   */
  readonly killGraceMs?: number;
}

/** Live session returned by `spawnClaude`. */
export interface ClaudeSession {
  /** Async-iterable of successfully parsed events, in arrival order. */
  readonly events: AsyncIterable<ClaudeEvent>;
  /** Resolves when the child exits; rejects if spawn itself failed. */
  readonly done: Promise<ClaudeExit>;
  /** stderr accumulated as a string. Read after `done` resolves. */
  readonly stderr: () => string;
  /** Snapshot diagnostics: counts of parse errors, events emitted, etc. */
  readonly stats: () => ClaudeSessionStats;
  /** The PID, available once the child has started. */
  readonly pid: number | undefined;
  /**
   * Cooperative cancel. Sends SIGTERM, escalates to SIGKILL after
   * `killGraceMs`. Idempotent: subsequent calls are no-ops. Calling after
   * the child has already exited is also a no-op.
   */
  readonly cancel: (reason?: CancelReason) => void;
}

/**
 * Why a session ended without delivering a normal `result` event. The SSE
 * layer uses this to write a structured error frame to the client.
 */
export type CancelReason = 'user' | 'timeout' | 'abort' | 'shutdown';

export interface ClaudeExit {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** True iff the session was terminated via `cancel()`, timeout, or abort. */
  readonly wasCancelled: boolean;
  /** Populated when `wasCancelled` is true. Undefined otherwise. */
  readonly cancelReason?: CancelReason;
}

export interface ClaudeSessionStats {
  readonly eventsEmitted: number;
  readonly parseErrors: number;
  readonly linesSeen: number;
}

const DEFAULT_BIN = 'claude';

/**
 * Build the argv that follows the binary path. Kept as a pure function for
 * testability (tests assert the exact argv shape).
 */
export function buildClaudeArgs(opts: SpawnClaudeOptions): string[] {
  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
  if (opts.model !== undefined) {
    args.push('--model', opts.model);
  }
  if (opts.extraArgs !== undefined) {
    args.push(...opts.extraArgs);
  }
  return args;
}

/**
 * Spawn the CLI and return a `ClaudeSession`. The function returns
 * synchronously; the iterator becomes consumable immediately. If spawn
 * itself fails (binary missing), `done` rejects with the underlying error.
 */
export function spawnClaude(opts: SpawnClaudeOptions): ClaudeSession {
  const bin = opts.claudeBin ?? process.env['CLAUDE_BIN'] ?? DEFAULT_BIN;
  const args = buildClaudeArgs(opts);
  const env = opts.env !== undefined ? { ...process.env, ...opts.env } : process.env;
  const spawnOptions = {
    env,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  };
  const child: ChildProcessWithoutNullStreams = spawn(bin, args, spawnOptions);

  // We do not write to the child; close stdin immediately so the CLI knows
  // there is no further input. This matches the contract callers expect.
  child.stdin.end();

  const stats: { eventsEmitted: number; parseErrors: number; linesSeen: number } = {
    eventsEmitted: 0,
    parseErrors: 0,
    linesSeen: 0,
  };
  let stderrBuf = '';
  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
  });

  // Pull/push buffer bridging readline → AsyncIterable. Capturing happens
  // eagerly so consumers attaching late do not miss the head of the stream.
  type PushItem = { kind: 'value'; value: ClaudeEvent } | { kind: 'end' } | { kind: 'error'; error: Error };
  const queue: PushItem[] = [];
  const waiters: Array<(item: PushItem) => void> = [];

  function push(item: PushItem): void {
    const w = waiters.shift();
    if (w !== undefined) w(item);
    else queue.push(item);
  }

  function pull(): Promise<PushItem> {
    const head = queue.shift();
    if (head !== undefined) return Promise.resolve(head);
    return new Promise((resolve) => waiters.push(resolve));
  }

  const rl: Interface = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    stats.linesSeen += 1;
    const r = parseEvent(line);
    if (!r.ok) {
      stats.parseErrors += 1;
      opts.onParseError?.(r.error);
      return;
    }
    if (r.event === null) return;
    stats.eventsEmitted += 1;
    push({ kind: 'value', value: r.event });
  });

  // Close path (any of: stdout EOF, child exit). We resolve `done` on the
  // child's 'close' event because that is when all stdio streams are
  // drained — using 'exit' alone risks missing buffered lines.
  let closed = false;
  const closeEnd = () => {
    if (closed) return;
    closed = true;
    push({ kind: 'end' });
  };
  rl.on('close', closeEnd);

  // Cancellation bookkeeping. `cancelReason` flips from undefined to a
  // concrete reason exactly once; subsequent kill attempts are no-ops.
  // `killGraceTimer` and `timeoutTimer` are `unref()`d so they never keep
  // the test process alive past suite completion.
  let cancelReason: CancelReason | undefined;
  let childExited = false;
  let killGraceTimer: NodeJS.Timeout | undefined;
  const killGraceMs = opts.killGraceMs ?? 2000;

  const cancel = (reason: CancelReason = 'user'): void => {
    if (childExited) return; // already done; nothing to kill
    if (cancelReason !== undefined) return; // idempotent
    cancelReason = reason;
    try {
      child.kill('SIGTERM');
    } catch {
      // Already-exited race on some platforms; ignore.
    }
    killGraceTimer = setTimeout(() => {
      if (!childExited) {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already-exited race; ignore.
        }
      }
    }, killGraceMs);
    killGraceTimer.unref();
  };

  // Per-session timeout. If `timeoutMs` elapses before close, cancel as
  // 'timeout'. The timer is unref()'d so it doesn't hold the loop open
  // when the parent is shutting down.
  let timeoutTimer: NodeJS.Timeout | undefined;
  if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => cancel('timeout'), opts.timeoutMs);
    timeoutTimer.unref();
  }

  // AbortSignal wiring. We honor a signal aborted *before* spawn returned
  // (rare but observable) and any later abort. Listener is removed on
  // close to keep the controller GC-friendly.
  const abortListener = () => cancel('abort');
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) {
      // Defer to next tick so the iterator is constructible before kill.
      queueMicrotask(() => cancel('abort'));
    } else {
      opts.signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  const done = new Promise<ClaudeExit>((resolve, reject) => {
    child.on('error', (err) => {
      childExited = true;
      if (killGraceTimer !== undefined) clearTimeout(killGraceTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      opts.signal?.removeEventListener('abort', abortListener);
      closeEnd();
      reject(err);
    });
    child.on('close', (exitCode, signal) => {
      childExited = true;
      if (killGraceTimer !== undefined) clearTimeout(killGraceTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      opts.signal?.removeEventListener('abort', abortListener);
      closeEnd();
      const base: ClaudeExit = {
        exitCode,
        signal,
        wasCancelled: cancelReason !== undefined,
        ...(cancelReason !== undefined ? { cancelReason } : {}),
      };
      resolve(base);
    });
  });

  const events: AsyncIterable<ClaudeEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<ClaudeEvent> {
      return {
        async next(): Promise<IteratorResult<ClaudeEvent>> {
          const item = await pull();
          if (item.kind === 'value') return { value: item.value, done: false };
          if (item.kind === 'error') throw item.error;
          return { value: undefined, done: true };
        },
      };
    },
  };

  // Silence default unhandled-rejection from `done` for callers that only
  // consume the iterator and never await `done`. They will get any error
  // via the iterator's next() throwing instead.
  done.catch(() => {});

  return {
    events,
    done,
    stderr: () => stderrBuf,
    stats: () => ({ ...stats }),
    pid: child.pid,
    cancel,
  };
}
