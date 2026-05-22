/**
 * Server-Sent Events writer. Wraps an Express `Response` into a typed
 * `SseStream` so the generate route never has to think about the wire
 * protocol.
 *
 * SSE wire format (per W3C EventSource spec):
 *   event: <name>\n
 *   data: <line 1>\n
 *   data: <line 2>\n
 *   \n                            <- frame terminator
 *
 * Multi-line data payloads MUST be split on `\n` and each line prefixed
 * with `data: ` — that is what makes the spec parseable by a streaming
 * tokenizer on the client. We JSON.stringify objects (which strips literal
 * newlines) but a payload could contain `\n` escapes that JSON renders as
 * the two-char sequence `\\n`, so the multi-line guard is for prose
 * strings, not for our JSON payloads. We still apply it unconditionally —
 * the cost is one `split` per event.
 *
 * Idempotent close: clients (and intermediaries) drop SSE streams at any
 * moment. `end()` must be safe to call more than once and from both the
 * route's `req.on('close')` handler AND the natural end-of-stream path.
 * Writes after close are no-ops, not errors.
 */
import type { Response } from '../types.js';

/** Public surface of the SSE writer. */
export interface SseStream {
  /**
   * Send an event frame. `name` is the SSE event name (the editor's
   * EventSource will dispatch a JS event by this name). `data` is any
   * JSON-serialisable value; null/undefined send an empty `data:` line.
   */
  readonly event: (name: string, data: unknown) => void;
  /**
   * Send a comment frame (`: ping\n\n`). Comments are ignored by the
   * EventSource API but keep idle proxies from severing the connection.
   * Industry default is one every 15s; the route decides scheduling.
   */
  readonly ping: () => void;
  /** Close the stream. Idempotent. Subsequent writes become no-ops. */
  readonly end: () => void;
  /** True once `end()` has been called or the underlying response closed. */
  readonly isClosed: () => boolean;
}

/**
 * Mandatory SSE response headers. The cache + connection hints prevent
 * proxies and browsers from buffering the stream.
 */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Tell nginx not to buffer this response. Harmless when nginx is not in the path.
  'X-Accel-Buffering': 'no',
} as const;

/**
 * Encode one SSE frame. Pure — no I/O. Exported for tests so the wire
 * format can be asserted without spinning up a server.
 */
export function encodeFrame(eventName: string, data: unknown): string {
  // null/undefined → empty data line. Anything else gets JSON-encoded.
  const payload = data === undefined || data === null ? '' : JSON.stringify(data);
  // Split on literal newlines so multi-line payloads remain SSE-compliant.
  const dataLines = payload.split('\n').map((line) => `data: ${line}`).join('\n');
  return `event: ${eventName}\n${dataLines}\n\n`;
}

/** Encode a comment frame for keep-alives. */
function encodePing(): string {
  return `: ping\n\n`;
}

/**
 * Wrap a Response. The function calls `writeHead` immediately so headers
 * flush before the first frame; downstream code can rely on a streaming
 * response from line one.
 *
 * `res` is assumed to be a fresh response object — calling on an already-
 * sent response will throw inside `writeHead` and that is the caller's bug.
 */
export function createSseStream(res: Response): SseStream {
  // writeHead with status 200 + headers. Express's Response inherits from
  // http.ServerResponse so this is the low-level path that bypasses
  // Express's body-serialisation logic.
  res.writeHead(200, SSE_HEADERS);
  // Force the headers onto the wire so the client receives them before
  // any waitable work begins. Some Node versions defer until the first
  // body chunk; `flushHeaders` is the explicit signal.
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;

  // The underlying socket might close while we are iterating events.
  // Latch a flag so subsequent writes do nothing rather than throwing
  // EPIPE/ECONNRESET inside `for await` loops upstream.
  res.on('close', () => {
    closed = true;
  });

  function safeWrite(chunk: string): void {
    if (closed) return;
    try {
      res.write(chunk);
    } catch {
      // The socket died between our `closed` check and the write.
      // Latch closed and swallow — the caller will observe via isClosed().
      closed = true;
    }
  }

  function event(name: string, data: unknown): void {
    safeWrite(encodeFrame(name, data));
  }

  function ping(): void {
    safeWrite(encodePing());
  }

  function end(): void {
    if (closed) return;
    closed = true;
    try {
      res.end();
    } catch {
      // Already closed at the socket level; nothing to do.
    }
  }

  function isClosed(): boolean {
    return closed;
  }

  return { event, ping, end, isClosed };
}
