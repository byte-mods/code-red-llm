/**
 * Incremental extractor: consumes `AsyncIterable<ClaudeEvent>` from the
 * subprocess bridge and yields `ExtractionResult`s one per sentinel block
 * (`<NODE>...</NODE>` or `<SCHEMA>...</SCHEMA>`) found in the model's text
 * output.
 *
 * Design contract — load this with `src/server/prompt/template.ts` open
 * in the other window:
 *
 *  - The model emits each Node-RED node as JSON between `SENTINEL_OPEN`
 *    and `SENTINEL_CLOSE` somewhere in `AssistantEvent.content[*].text`.
 *  - The model may emit schema definitions as JSON between
 *    `SENTINEL_SCHEMA_OPEN` and `SENTINEL_SCHEMA_CLOSE`.
 *  - A sentinel pair may span two or more events. The extractor buffers
 *    the in-flight portion until the close sentinel arrives.
 *  - Text outside any sentinel pair is ignored — explanatory prose
 *    between blocks does not affect extraction.
 *  - Only `TextBlock` content is scanned. `ToolUseBlock`/`ToolResultBlock`/
 *    `OtherBlock` would carry structured data, not the sentinel format.
 *
 * Safety:
 *  - `JSON.parse` is wrapped — never throws past the iterator.
 *  - The unclosed-buffer cap (BUFFER_CAP_BYTES) prevents runaway memory
 *    if the model emits an open sentinel and never closes it. On overflow we
 *    yield `runaway-sentinel`, drop the buffer, and resume scanning.
 *  - Buffer left dangling when the source iterator ends is silently
 *    discarded — better than yielding a partial result.
 */
import type { ClaudeEvent, ContentBlock } from '../claude/index.js';
import {
  SENTINEL_OPEN,
  SENTINEL_CLOSE,
  SENTINEL_SCHEMA_OPEN,
  SENTINEL_SCHEMA_CLOSE,
} from '../prompt/index.js';
import { validateNode } from './validator.js';
import type { ExtractionResult, SchemaDefinition } from './types.js';

/**
 * Hard cap on in-flight (between-sentinel) buffer size. Beyond this the
 * extractor concludes the open sentinel will never close and emits a
 * `runaway-sentinel` error. 64KB is several orders of magnitude larger
 * than any plausible JSON payload.
 */
const BUFFER_CAP_BYTES = 64 * 1024;

/**
 * Pull every `text` substring out of an assistant turn's content array.
 * Other block kinds are ignored — see contract above.
 */
/**
 * Type guard for TextBlock. OtherBlock has `type: string` (no narrow
 * literal) and shares structural shape with TextBlock, so a bare
 * `block.type === 'text'` check does not narrow away OtherBlock. We
 * additionally require a string `text` field — OtherBlock has no such
 * field, so the conjunction is a sound narrowing.
 */
function isTextBlock(block: ContentBlock): block is { type: 'text'; text: string } {
  return block.type === 'text' && 'text' in block && typeof block.text === 'string';
}

function textsFromAssistant(content: readonly ContentBlock[]): string[] {
  const out: string[] = [];
  for (const block of content) {
    if (isTextBlock(block)) out.push(block.text);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Try to parse a candidate JSON string, validate it, and turn the
 * outcome into an `ExtractionResult`. Pure — no side effects.
 */
function processCandidate(json: string): ExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { kind: 'error', reason: 'malformed-json', detail };
  }
  if (!isPlainObject(parsed)) {
    return { kind: 'error', reason: 'not-an-object', detail: 'inner JSON must be an object' };
  }
  const v = validateNode(parsed);
  if (!v.ok) {
    return { kind: 'error', reason: 'validation-failed', detail: v.errors.join('; ') };
  }
  return { kind: 'node', node: v.node };
}

/**
 * Try to parse a schema candidate JSON string and turn it into an
 * `ExtractionResult`. Pure — no side effects.
 */
function processSchemaCandidate(json: string): ExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { kind: 'error', reason: 'malformed-json', detail };
  }
  if (!isPlainObject(parsed)) {
    return { kind: 'error', reason: 'not-an-object', detail: 'inner JSON must be an object' };
  }
  const nodeId = typeof parsed['nodeId'] === 'string' ? parsed['nodeId'] : undefined;
  const fields = parsed['fields'];
  if (nodeId === undefined) {
    return { kind: 'error', reason: 'validation-failed', detail: 'schema missing nodeId' };
  }
  if (!isPlainObject(fields)) {
    return { kind: 'error', reason: 'validation-failed', detail: 'schema fields must be an object' };
  }
  const validatedFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') {
      return { kind: 'error', reason: 'validation-failed', detail: `schema field ${key} must be a type tag string` };
    }
    validatedFields[key] = value;
  }
  return { kind: 'schema', schema: { nodeId, fields: validatedFields } };
}

type SentinelPair = { open: string; close: string; kind: 'node' | 'schema' };

const SENTINELS: SentinelPair[] = [
  { open: SENTINEL_OPEN, close: SENTINEL_CLOSE, kind: 'node' },
  { open: SENTINEL_SCHEMA_OPEN, close: SENTINEL_SCHEMA_CLOSE, kind: 'schema' },
];

const MAX_OPEN_LEN = Math.max(...SENTINELS.map((s) => s.open.length));

/**
 * Scan a concatenated text buffer for complete sentinel blocks.
 * Returns the per-block results in order PLUS the unprocessed tail.
 *
 * The tail is everything from the last unmatched open sentinel onward, or the
 * empty string if no open sentinel remains. The caller prepends the next
 * event's text to this tail before the next call — that's how we handle
 * sentinels that straddle events.
 *
 * Text outside sentinel pairs is discarded (model prose between blocks).
 *
 * Overflow handling: if an open sentinel has been outstanding for more
 * than `BUFFER_CAP_BYTES`, we emit `runaway-sentinel`, discard up to and
 * including the offending open sentinel, and continue scanning from there.
 */
function scan(buffer: string): { results: ExtractionResult[]; tail: string } {
  const results: ExtractionResult[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    let bestOpen = -1;
    let bestSentinel: SentinelPair | undefined;
    for (const s of SENTINELS) {
      const idx = buffer.indexOf(s.open, cursor);
      if (idx !== -1 && (bestOpen === -1 || idx < bestOpen)) {
        bestOpen = idx;
        bestSentinel = s;
      }
    }

    if (bestOpen === -1 || bestSentinel === undefined) {
      // No COMPLETE open sentinel remains. Preserve a tail just long enough
      // to cover any partial-sentinel prefix.
      const keep = MAX_OPEN_LEN - 1;
      const tailStart = Math.max(cursor, buffer.length - keep);
      return { results, tail: buffer.slice(tailStart) };
    }

    const innerStart = bestOpen + bestSentinel.open.length;
    const closeIdx = buffer.indexOf(bestSentinel.close, innerStart);
    if (closeIdx === -1) {
      // Open sentinel without a close yet.
      const pending = buffer.length - bestOpen;
      if (pending > BUFFER_CAP_BYTES) {
        results.push({
          kind: 'error',
          reason: 'runaway-sentinel',
          detail: `open sentinel exceeded ${String(BUFFER_CAP_BYTES)} bytes without a close`,
        });
        // Skip past the offending open sentinel and keep scanning.
        cursor = innerStart;
        continue;
      }
      // Wait for more text. The whole open-onward slice is the tail.
      return { results, tail: buffer.slice(bestOpen) };
    }

    const inner = buffer.slice(innerStart, closeIdx);
    if (bestSentinel.kind === 'node') {
      results.push(processCandidate(inner));
    } else {
      results.push(processSchemaCandidate(inner));
    }
    cursor = closeIdx + bestSentinel.close.length;
  }
  return { results, tail: '' };
}

/**
 * Drive the source iterator and yield extraction results as they come.
 * Concurrency: single-consumer; we await each source event before
 * scanning, so back-pressure is natural — if the consumer is slow at
 * pulling results, we slow our reads from the bridge.
 */
export async function* extractNodes(
  events: AsyncIterable<ClaudeEvent>,
): AsyncIterable<ExtractionResult> {
  let buffer = '';
  for await (const ev of events) {
    if (ev.type !== 'assistant') continue;
    const texts = textsFromAssistant(ev.content);
    if (texts.length === 0) continue;
    buffer += texts.join('');
    const { results, tail } = scan(buffer);
    buffer = tail;
    for (const r of results) yield r;
  }
  // Source iterator drained. A non-empty buffer here means an open
  // sentinel never closed; silently discard.
}
