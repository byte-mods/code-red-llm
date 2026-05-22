/**
 * Incremental extractor: consumes `AsyncIterable<ClaudeEvent>` from the
 * subprocess bridge and yields `NodeExtractionResult`s one per
 * `<NODE>...</NODE>` block found in the model's text output.
 *
 * Design contract — load this with `src/server/prompt/template.ts` open
 * in the other window:
 *
 *  - The model emits each Node-RED node as JSON between `SENTINEL_OPEN`
 *    and `SENTINEL_CLOSE` somewhere in `AssistantEvent.content[*].text`.
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
 *    if the model emits `<NODE>` and never closes it. On overflow we
 *    yield `runaway-sentinel`, drop the buffer, and resume scanning.
 *  - Buffer left dangling when the source iterator ends is silently
 *    discarded — better than yielding a partial node.
 */
import type { ClaudeEvent, ContentBlock } from '../claude/index.js';
import { SENTINEL_OPEN, SENTINEL_CLOSE } from '../prompt/index.js';
import { validateNode } from './validator.js';
import type { NodeExtractionResult } from './types.js';

/**
 * Hard cap on in-flight (between-sentinel) buffer size. Beyond this the
 * extractor concludes the open sentinel will never close and emits a
 * `runaway-sentinel` error. 64KB is several orders of magnitude larger
 * than any plausible Node-RED node JSON.
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

/**
 * Try to parse a candidate JSON string, validate it, and turn the
 * outcome into a `NodeExtractionResult`. Pure — no side effects.
 */
function processCandidate(json: string): NodeExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { kind: 'error', reason: 'malformed-json', detail };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'error', reason: 'not-an-object', detail: 'inner JSON must be an object' };
  }
  const v = validateNode(parsed);
  if (!v.ok) {
    return { kind: 'error', reason: 'validation-failed', detail: v.errors.join('; ') };
  }
  return { kind: 'node', node: v.node };
}

/**
 * Scan a concatenated text buffer for complete `<NODE>...</NODE>` blocks.
 * Returns the per-block results in order PLUS the unprocessed tail.
 *
 * The tail is everything from the last unmatched `<NODE>` onward, or the
 * empty string if no open sentinel remains. The caller prepends the next
 * event's text to this tail before the next call — that's how we handle
 * sentinels that straddle events.
 *
 * Text outside sentinel pairs is discarded (model prose between blocks).
 *
 * Overflow handling: if an open sentinel has been outstanding for more
 * than `BUFFER_CAP_BYTES`, we emit `runaway-sentinel`, discard up to and
 * including the offending `<NODE>`, and continue scanning from there.
 */
function scan(buffer: string): { results: NodeExtractionResult[]; tail: string } {
  const results: NodeExtractionResult[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const openIdx = buffer.indexOf(SENTINEL_OPEN, cursor);
    if (openIdx === -1) {
      // No COMPLETE open sentinel remains. The trailing bytes might still
      // be a *prefix* of an open sentinel that will complete on the next
      // event ("<NO" + "DE>..."). Preserve a tail just long enough to
      // cover any partial-sentinel prefix; everything before it was prose
      // that did not lead to a block and can be discarded.
      const keep = SENTINEL_OPEN.length - 1;
      const tailStart = Math.max(cursor, buffer.length - keep);
      return { results, tail: buffer.slice(tailStart) };
    }
    const innerStart = openIdx + SENTINEL_OPEN.length;
    const closeIdx = buffer.indexOf(SENTINEL_CLOSE, innerStart);
    if (closeIdx === -1) {
      // Open sentinel without a close yet. Either we're mid-block (wait
      // for more text) or the model went runaway (cap exceeded).
      const pending = buffer.length - openIdx;
      if (pending > BUFFER_CAP_BYTES) {
        results.push({
          kind: 'error',
          reason: 'runaway-sentinel',
          detail: `open sentinel exceeded ${String(BUFFER_CAP_BYTES)} bytes without a close`,
        });
        // Skip past the offending open sentinel and keep scanning. This
        // sacrifices the runaway content but lets subsequent valid
        // blocks still emit.
        cursor = innerStart;
        continue;
      }
      // Wait for more text. The whole open-onward slice is the tail.
      return { results, tail: buffer.slice(openIdx) };
    }
    const inner = buffer.slice(innerStart, closeIdx);
    results.push(processCandidate(inner));
    cursor = closeIdx + SENTINEL_CLOSE.length;
  }
  return { results, tail: '' };
}

/**
 * Drive the source iterator and yield extraction results as they come.
 * Concurrency: single-consumer; we await each source event before
 * scanning, so back-pressure is natural — if the consumer is slow at
 * pulling node results, we slow our reads from the bridge.
 */
export async function* extractNodes(
  events: AsyncIterable<ClaudeEvent>,
): AsyncIterable<NodeExtractionResult> {
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
  // sentinel never closed; silently discard — yielding a half-baked
  // result would be worse than no result.
}
