/**
 * Discriminated union modelling the `claude --output-format stream-json` event
 * stream. Each line of the CLI's stdout is one JSON object; the `type` field
 * selects the variant.
 *
 * Design rules:
 *  - Type only the fields the rest of the system actually reads. Anthropic
 *    adds optional fields to these envelopes over time; reaching for them
 *    later is fine, but speculatively typing everything is over-fitting and
 *    bites you when the surface drifts.
 *  - Every variant carries the original raw payload (`raw`) so consumers can
 *    fall back to dynamic access for fields we deliberately do not type.
 *  - Unknown `type` values become `UnknownEvent` rather than parse errors —
 *    forward-compat is more important than strictness here. Strictness is
 *    enforced by code that consumes events (the S3 node extractor, S4 SSE
 *    writer), not by the parser.
 *
 * Snapshot of the captured wire format is at test/fixtures/*.jsonl. Update
 * those alongside this file when extending the union.
 */

/** A raw stream-json object (parsed but not yet variant-narrowed). */
export type RawEvent = Readonly<Record<string, unknown>>;

// ---------- assistant content blocks ----------

/**
 * Plain text emitted by the model. The narrow shape that S3's incremental
 * extractor will scan for sentinel-delimited Node-RED node JSON.
 */
export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Tool call request emitted by the model. Carries the tool name + its input
 * payload. S3 will likely instruct the model to emit nodes as `tool_use`
 * blocks rather than as embedded JSON in text — narrower than parsing text.
 */
export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/**
 * Tool result fed back to the model. Shape varies (string or array of
 * sub-blocks); we keep `content` as `unknown` and let consumers inspect it.
 */
export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: unknown;
}

/**
 * Any other content block (thinking, image, redacted, future additions).
 * Preserves the type tag and the raw block for inspection.
 */
export interface OtherBlock {
  readonly type: string;
  readonly raw: RawEvent;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | OtherBlock;

// ---------- top-level events ----------

/**
 * Fires exactly once at the start of every session. Carries metadata the
 * SSE layer (S4) will forward to clients for display.
 */
export interface SystemInitEvent {
  readonly type: 'system';
  readonly subtype: 'init';
  readonly session_id: string;
  readonly model: string;
  readonly cwd?: string;
  readonly raw: RawEvent;
}

/**
 * A `system` event that is NOT the init variant. Rare but reserved for
 * forward-compat (e.g., a future `system/error` envelope).
 */
export interface SystemOtherEvent {
  readonly type: 'system';
  readonly subtype: string;
  readonly raw: RawEvent;
}

/**
 * One assistant turn. May contain multiple content blocks. If the CLI emits
 * an authentication or runtime error, the envelope includes an `error`
 * string and a stop_reason — we surface those here so consumers do not have
 * to dig into `raw`.
 */
export interface AssistantEvent {
  readonly type: 'assistant';
  readonly session_id: string;
  readonly uuid?: string;
  readonly content: readonly ContentBlock[];
  readonly stop_reason?: string;
  readonly error?: string;
  readonly raw: RawEvent;
}

/**
 * A user-role envelope, almost always carrying `tool_result` content blocks
 * that the CLI is feeding back into the model.
 */
export interface UserEvent {
  readonly type: 'user';
  readonly session_id: string;
  readonly content: readonly ContentBlock[];
  readonly raw: RawEvent;
}

/**
 * Terminal event. `is_error: true` signals the session ended in failure
 * (auth, exceeded budget, model error, etc.). Consumers should treat this
 * as the close marker for the iterator regardless of `is_error`.
 */
export interface ResultEvent {
  readonly type: 'result';
  readonly subtype: string;
  readonly session_id: string;
  readonly is_error: boolean;
  readonly duration_ms?: number;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly result?: string;
  readonly raw: RawEvent;
}

/**
 * Partial-message stream event. Emitted only with `--include-partial-messages`
 * and forwarded as-is to the client when the SSE layer enables token
 * streaming. We do not narrow the inner `event` payload because Anthropic's
 * delta types evolve quickly.
 */
export interface StreamEvent {
  readonly type: 'stream_event';
  readonly session_id?: string;
  readonly event: RawEvent;
  readonly raw: RawEvent;
}

/**
 * Forward-compat escape hatch. Any event whose `type` we do not recognize is
 * surfaced here so the iterator keeps flowing.
 */
export interface UnknownEvent {
  readonly type: '__unknown__';
  readonly originalType: string;
  readonly raw: RawEvent;
}

/**
 * The discriminated union the parser produces and downstream consumers
 * exhaustively switch on.
 */
export type ClaudeEvent =
  | SystemInitEvent
  | SystemOtherEvent
  | AssistantEvent
  | UserEvent
  | ResultEvent
  | StreamEvent
  | UnknownEvent;
