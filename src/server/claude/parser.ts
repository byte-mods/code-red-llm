/**
 * Pure line-to-ClaudeEvent parser.
 *
 * Contract:
 *  - Never throws. All failures surface as `{ok: false, ...}` results.
 *  - Empty / whitespace-only lines return `{ok: true, event: null}` so the
 *    caller can simply skip them without branching on a sentinel.
 *  - Malformed JSON or non-object payloads return `{ok: false, ...}`.
 *  - Unknown event types yield a parsed `UnknownEvent` rather than an error,
 *    so a single new envelope from a future `claude` release does not stop
 *    the stream.
 *
 * The parser is intentionally lenient on optional fields. The CLI's wire
 * format adds fields over time; the type definitions in `events.ts` model
 * only what we currently read, and `raw` preserves the rest for consumers
 * that want to peek.
 */
import type {
  AssistantEvent,
  ClaudeEvent,
  ContentBlock,
  OtherBlock,
  RawEvent,
  ResultEvent,
  StreamEvent,
  SystemInitEvent,
  SystemOtherEvent,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
  UnknownEvent,
  UserEvent,
} from './events.js';

/**
 * The parser result.
 *  - `event: null` means the input was empty/whitespace — skip silently.
 *  - `event: ClaudeEvent` is a successful parse.
 *  - The `ok: false` branch carries a structured error + the offending raw
 *    line so failures can be diagnosed downstream.
 */
export type ParseResult =
  | { readonly ok: true; readonly event: ClaudeEvent | null }
  | { readonly ok: false; readonly error: ParseError };

/**
 * Structured parse failure. `kind` lets consumers (a) log distinct counters
 * per failure mode and (b) decide whether to abort the session or skip the
 * line and continue.
 */
export interface ParseError {
  readonly kind: 'malformed-json' | 'not-an-object' | 'missing-type';
  readonly message: string;
  readonly rawLine: string;
}

/**
 * Top-level entry. Idempotent and side-effect-free.
 */
export function parseEvent(line: string): ParseResult {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { ok: true, event: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'malformed-json',
        message: e instanceof Error ? e.message : String(e),
        rawLine: line,
      },
    };
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      error: { kind: 'not-an-object', message: 'top-level value is not an object', rawLine: line },
    };
  }

  const type = parsed['type'];
  if (typeof type !== 'string') {
    return {
      ok: false,
      error: { kind: 'missing-type', message: 'missing or non-string "type" field', rawLine: line },
    };
  }

  return { ok: true, event: narrowEvent(type, parsed) };
}

// ---------- internals ----------

function isObject(v: unknown): v is RawEvent {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Narrow a parsed object to one of the union variants. Always returns a
 * value — falls back to `UnknownEvent` for unrecognized types so the stream
 * does not halt on a new event kind.
 */
function narrowEvent(type: string, raw: RawEvent): ClaudeEvent {
  switch (type) {
    case 'system':
      return narrowSystem(raw);
    case 'assistant':
      return narrowAssistant(raw);
    case 'user':
      return narrowUser(raw);
    case 'result':
      return narrowResult(raw);
    case 'stream_event':
      return narrowStream(raw);
    default:
      return makeUnknown(type, raw);
  }
}

function narrowSystem(raw: RawEvent): SystemInitEvent | SystemOtherEvent | UnknownEvent {
  const subtype = asString(raw['subtype']);
  if (subtype === 'init') {
    const session_id = asString(raw['session_id']) ?? '';
    const model = asString(raw['model']) ?? '';
    const ev: SystemInitEvent = {
      type: 'system',
      subtype: 'init',
      session_id,
      model,
      ...(asString(raw['cwd']) !== undefined ? { cwd: asString(raw['cwd'])! } : {}),
      raw,
    };
    return ev;
  }
  if (subtype !== undefined) {
    return { type: 'system', subtype, raw };
  }
  // system without a recognizable subtype: surface as Unknown so consumers
  // do not accidentally treat it as init.
  return makeUnknown('system', raw);
}

function narrowAssistant(raw: RawEvent): AssistantEvent {
  const session_id = asString(raw['session_id']) ?? '';
  const uuid = asString(raw['uuid']);
  const errorField = asString(raw['error']);
  const messageRaw = raw['message'];
  let content: readonly ContentBlock[] = [];
  let stop_reason: string | undefined;
  if (isObject(messageRaw)) {
    content = extractContent(messageRaw['content']);
    stop_reason = asString(messageRaw['stop_reason']);
  }
  const ev: AssistantEvent = {
    type: 'assistant',
    session_id,
    content,
    ...(uuid !== undefined ? { uuid } : {}),
    ...(stop_reason !== undefined ? { stop_reason } : {}),
    ...(errorField !== undefined ? { error: errorField } : {}),
    raw,
  };
  return ev;
}

function narrowUser(raw: RawEvent): UserEvent {
  const session_id = asString(raw['session_id']) ?? '';
  const messageRaw = raw['message'];
  const content = isObject(messageRaw) ? extractContent(messageRaw['content']) : [];
  return { type: 'user', session_id, content, raw };
}

function narrowResult(raw: RawEvent): ResultEvent {
  const session_id = asString(raw['session_id']) ?? '';
  const subtype = asString(raw['subtype']) ?? '';
  const is_error = asBool(raw['is_error'], false);
  const duration_ms = asNumber(raw['duration_ms']);
  const num_turns = asNumber(raw['num_turns']);
  const total_cost_usd = asNumber(raw['total_cost_usd']);
  const result = asString(raw['result']);
  const ev: ResultEvent = {
    type: 'result',
    subtype,
    session_id,
    is_error,
    ...(duration_ms !== undefined ? { duration_ms } : {}),
    ...(num_turns !== undefined ? { num_turns } : {}),
    ...(total_cost_usd !== undefined ? { total_cost_usd } : {}),
    ...(result !== undefined ? { result } : {}),
    raw,
  };
  return ev;
}

function narrowStream(raw: RawEvent): StreamEvent {
  const session_id = asString(raw['session_id']);
  const eventRaw = isObject(raw['event']) ? (raw['event'] as RawEvent) : {};
  const ev: StreamEvent = {
    type: 'stream_event',
    event: eventRaw,
    ...(session_id !== undefined ? { session_id } : {}),
    raw,
  };
  return ev;
}

function makeUnknown(originalType: string, raw: RawEvent): UnknownEvent {
  return { type: '__unknown__', originalType, raw };
}

/**
 * Extract typed content blocks from a `message.content` array. Each entry is
 * narrowed to TextBlock / ToolUseBlock / ToolResultBlock or surfaced as
 * OtherBlock. Non-array inputs yield an empty list.
 */
function extractContent(blocks: unknown): readonly ContentBlock[] {
  if (!Array.isArray(blocks)) return [];
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (!isObject(b)) continue;
    const t = asString(b['type']);
    if (t === undefined) continue;
    if (t === 'text') {
      const text = asString(b['text']) ?? '';
      const block: TextBlock = { type: 'text', text };
      out.push(block);
    } else if (t === 'tool_use') {
      const id = asString(b['id']) ?? '';
      const name = asString(b['name']) ?? '';
      const block: ToolUseBlock = { type: 'tool_use', id, name, input: b['input'] };
      out.push(block);
    } else if (t === 'tool_result') {
      const tool_use_id = asString(b['tool_use_id']) ?? '';
      const block: ToolResultBlock = { type: 'tool_result', tool_use_id, content: b['content'] };
      out.push(block);
    } else {
      const block: OtherBlock = { type: t, raw: b };
      out.push(block);
    }
  }
  return out;
}
