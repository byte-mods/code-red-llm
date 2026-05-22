/**
 * `GET /no-code-red/generate` — the route that turns a user prompt into a
 * stream of validated Node-RED nodes over Server-Sent Events.
 *
 * Wire shape (one event frame per occurrence):
 *   event: meta   → { generationId, model?, sessionId? }   (once, at start)
 *   event: node   → NodeRedNode                            (zero or more)
 *   event: error  → { reason, detail }                     (zero or more)
 *   event: done   → { exitCode, wasCancelled, cancelReason?, stats }
 *
 * Query params:
 *   prompt   (required) — the user's natural-language request
 *   flowId   (optional) — Node-RED tab id; defaults to 'flow-main'
 *   model    (optional) — claude model alias forwarded to the CLI
 *
 * Lifecycle:
 *   1. validate prompt → 400 if missing/empty
 *   2. open SSE stream (headers flush)
 *   3. spawnClaude(prompt) → wrap session.events with extractNodes
 *   4. for-await: emit `node` / `error` per extraction result
 *   5. on req.close: session.cancel('user') — stops the child + drains
 *   6. on session.done: emit `done` frame and end the stream
 *
 * Concurrency: each request owns its own ClaudeSession. No shared state.
 * The 15s heartbeat keeps idle proxies from severing the connection on
 * the long quiet stretches between model tokens.
 */
import { randomUUID } from 'node:crypto';

import type { Request, Response } from '../types.js';
import { spawnClaude } from '../claude/index.js';
import { buildPrompt } from '../prompt/index.js';
import { extractNodes } from '../extractor/index.js';
import { createSseStream } from './writer.js';
import type { GenerationRegistry, HistoryWriter } from '../session/index.js';

const HEARTBEAT_MS = 15_000;

/**
 * Maximum accepted prompt length. The CLI itself accepts ~128KB argv,
 * but a 8KB prompt is already enormous for natural-language input and
 * larger requests are almost certainly accidental (paste of a file).
 */
const MAX_PROMPT_BYTES = 8 * 1024;

/**
 * Per-IP rate limit: at most one generation in flight every N ms. Backed
 * by a Map<ip, lastTimestamp>. This is a soft local guard, not a security
 * boundary — Node-RED's admin auth is the real gate. Defaults to 2s.
 */
const RATE_LIMIT_MS = 2_000;
const rateLimitState = new Map<string, number>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const prev = rateLimitState.get(ip) ?? 0;
  if (now - prev < RATE_LIMIT_MS) return false;
  rateLimitState.set(ip, now);
  // Bound the map: drop any entry older than 10x the window.
  if (rateLimitState.size > 1000) {
    const cutoff = now - RATE_LIMIT_MS * 10;
    for (const [k, v] of rateLimitState) {
      if (v < cutoff) rateLimitState.delete(k);
    }
  }
  return true;
}

/**
 * Optional dependencies the route wires in S6 — registry for cancel-by-id
 * + concurrency cap, history writer for replayable JSONL log. The route
 * runs unchanged when these are undefined (matches the S4 contract used
 * by existing tests).
 */
export interface GenerateDeps {
  readonly registry?: GenerationRegistry;
  readonly historyFor?: (generationId: string) => HistoryWriter | undefined;
}

/**
 * Read a query parameter as a non-empty trimmed string, or null. Express
 * leaves `req.query` typed as `Record<string, unknown>`; we narrow without
 * casting through `unknown`/`any`.
 */
function firstString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The handler. Exported as a function rather than installed eagerly so
 * `plugin.ts` controls when (and how) it is mounted.
 */
export async function handleGenerate(
  req: Request,
  res: Response,
  deps: GenerateDeps = {},
): Promise<void> {
  const prompt = firstString(req.query['prompt']);
  if (prompt === null) {
    res.status(400).json({ error: 'query param "prompt" is required' });
    return;
  }
  if (Buffer.byteLength(prompt, 'utf-8') > MAX_PROMPT_BYTES) {
    res.status(413).json({
      error: `prompt exceeds ${String(MAX_PROMPT_BYTES)} bytes`,
    });
    return;
  }
  // Rate-limit per remote address. `req.ip` is Express's parsed remote
  // address; fall back to a coarse bucket if unavailable.
  const ip = (req as unknown as { ip?: string }).ip ?? 'unknown';
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: 'too many requests; slow down' });
    return;
  }
  const flowId = firstString(req.query['flowId']) ?? undefined;
  const model = firstString(req.query['model']) ?? undefined;

  // Bounded concurrency. If the registry exists and is full, refuse the
  // request BEFORE flushing SSE headers so the client gets a real 503.
  if (deps.registry !== undefined && !deps.registry.tryAcquire()) {
    res.status(503).json({ error: 'too many concurrent generations; try again shortly' });
    return;
  }

  // Open the SSE stream BEFORE spawning. If spawn fails (binary missing)
  // we still surface a structured `error` + `done` to the client rather
  // than 500-ing after headers were sent.
  const sse = createSseStream(res);
  const generationId = randomUUID();
  const history = deps.historyFor?.(generationId);

  // Heartbeat keeps idle intermediaries happy. We cancel on close so the
  // timer never outlives the stream.
  const heartbeat = setInterval(() => {
    if (sse.isClosed()) {
      clearInterval(heartbeat);
      return;
    }
    sse.ping();
  }, HEARTBEAT_MS);
  // Do not let this timer keep the event loop alive past suite end.
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  const fullPrompt = buildPrompt(prompt, flowId !== undefined ? { flowId } : {});
  const session = spawnClaude({
    prompt: fullPrompt,
    ...(model !== undefined ? { model } : {}),
  });

  // Register so /generations and /cancel can find this generation by id.
  deps.registry?.register({
    id: generationId,
    prompt,
    flowId,
    model,
    startedAt: Date.now(),
    session,
  });

  // Client disconnect → cooperative cancel. The bridge handles SIGTERM
  // escalation. Safe to call before or after session.done resolves.
  req.on('close', () => {
    session.cancel('user');
  });

  // First frame: identify the generation so the client can correlate
  // future events (cancel calls, logs, etc.).
  const metaPayload = { generationId, model: model ?? null, flowId: flowId ?? 'flow-main', prompt };
  sse.event('meta', metaPayload);
  void history?.record('meta', metaPayload);

  // Stream extraction results until the iterator completes naturally
  // (child exit, or cancel-driven drain). Each result is at most one
  // node or one structured error — the writer handles JSON encoding.
  try {
    for await (const r of extractNodes(session.events)) {
      if (sse.isClosed()) break;
      if (r.kind === 'node') {
        sse.event('node', r.node);
        void history?.record('node', r.node);
      } else if (r.kind === 'schema') {
        sse.event('schema', r.schema);
        void history?.record('schema', r.schema);
      } else {
        const err = { reason: r.reason, detail: r.detail };
        sse.event('error', err);
        void history?.record('error', err);
      }
    }
  } catch (e) {
    // The extractor itself never throws past the iterator, but the
    // for-await mechanism can surface an error if the bridge rejects
    // mid-stream (rare — only the spawn-error path).
    const detail = e instanceof Error ? e.message : String(e);
    const err = { reason: 'stream-failed', detail };
    sse.event('error', err);
    void history?.record('error', err);
  }

  // Wait for the bridge to fully close so the `done` frame carries the
  // real exit code. If `done` was already rejected (spawn error), the
  // catch records it; the frame still lands.
  let exit: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    wasCancelled: boolean;
    cancelReason?: string;
  } = {
    exitCode: null,
    signal: null,
    wasCancelled: false,
  };
  try {
    const e = await session.done;
    exit = { ...e };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    sse.event('error', { reason: 'spawn-failed', detail });
  }

  clearInterval(heartbeat);
  const donePayload = {
    generationId,
    exitCode: exit.exitCode,
    wasCancelled: exit.wasCancelled,
    ...(exit.cancelReason !== undefined ? { cancelReason: exit.cancelReason } : {}),
    stats: session.stats(),
  };
  sse.event('done', donePayload);
  void history?.record('done', donePayload);
  sse.end();
  // Remove from registry once the generation is fully closed.
  deps.registry?.remove(generationId);
}
