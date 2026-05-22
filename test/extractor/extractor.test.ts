/**
 * Tests for `extractNodes` — the incremental extractor that consumes
 * `AsyncIterable<ClaudeEvent>` and yields validated nodes (or typed errors)
 * per sentinel block.
 *
 * Strategy: never spawn anything. Hand-build a fake AsyncIterable that
 * yields synthesized AssistantEvents so we can exercise every edge case
 * deterministically — split sentinels, malformed JSON, non-object inner
 * payload, runaway open-without-close, text outside sentinels, multiple
 * blocks per event, empty/non-assistant events.
 *
 * Naming: test_extractNodes_<scenario>_<expected_behavior>.
 */
import { describe, expect, it } from 'vitest';

import type { AssistantEvent, ClaudeEvent } from '../../src/server/claude/index.js';
import { SENTINEL_OPEN, SENTINEL_CLOSE } from '../../src/server/prompt/index.js';
import { extractNodes, type NodeExtractionResult } from '../../src/server/extractor/index.js';

/**
 * Build a fake AssistantEvent whose content is a single TextBlock with
 * the given text. Other fields get sane defaults; the extractor reads
 * neither raw nor session_id, but they must be present to type-check.
 */
function assistant(text: string): AssistantEvent {
  return {
    type: 'assistant',
    session_id: 's',
    content: [{ type: 'text', text }],
    raw: {},
  };
}

/** Source iterator built from a synchronous array of events. */
async function* source(events: ClaudeEvent[]): AsyncIterable<ClaudeEvent> {
  for (const e of events) yield e;
}

/** Drain `extractNodes` into an array for easy assertion. */
async function drain(events: ClaudeEvent[]): Promise<NodeExtractionResult[]> {
  const out: NodeExtractionResult[] = [];
  for await (const r of extractNodes(source(events))) out.push(r);
  return out;
}

/** A valid node JSON the validator will accept. */
const VALID_NODE_JSON = '{"id":"n1","type":"inject","x":100,"y":100,"wires":[["n2"]]}';
const VALID_NODE_2_JSON = '{"id":"n2","type":"debug","x":300,"y":100,"wires":[]}';

const block = (json: string): string => `${SENTINEL_OPEN}${json}${SENTINEL_CLOSE}`;

describe('extractNodes — happy paths', () => {
  it('test_extractNodes_yields_one_node_per_complete_block', async () => {
    const out = await drain([assistant(block(VALID_NODE_JSON))]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('node');
    if (out[0]?.kind === 'node') expect(out[0].node.id).toBe('n1');
  });

  it('test_extractNodes_yields_multiple_nodes_from_one_event', async () => {
    const text = block(VALID_NODE_JSON) + 'prose between\n' + block(VALID_NODE_2_JSON);
    const out = await drain([assistant(text)]);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.kind === 'node')).toBe(true);
  });

  it('test_extractNodes_ignores_text_outside_sentinels', async () => {
    const text = `here is your flow:\n\n${block(VALID_NODE_JSON)}\n\nthat's all`;
    const out = await drain([assistant(text)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('node');
  });
});

describe('extractNodes — sentinel boundaries straddling events', () => {
  it('test_extractNodes_handles_sentinel_split_across_events', async () => {
    // Split the open sentinel mid-tag: "<NO" + "DE>...</NODE>"
    const half = SENTINEL_OPEN.slice(0, 3);
    const rest = SENTINEL_OPEN.slice(3) + VALID_NODE_JSON + SENTINEL_CLOSE;
    const out = await drain([assistant(half), assistant(rest)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('node');
  });

  it('test_extractNodes_handles_json_split_across_events', async () => {
    const opening = SENTINEL_OPEN + VALID_NODE_JSON.slice(0, 20);
    const tail = VALID_NODE_JSON.slice(20) + SENTINEL_CLOSE;
    const out = await drain([assistant(opening), assistant(tail)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('node');
  });

  it('test_extractNodes_handles_close_sentinel_split_across_events', async () => {
    const head = SENTINEL_OPEN + VALID_NODE_JSON + SENTINEL_CLOSE.slice(0, 3);
    const tail = SENTINEL_CLOSE.slice(3);
    const out = await drain([assistant(head), assistant(tail)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('node');
  });

  it('test_extractNodes_handles_block_spanning_many_events', async () => {
    // Three events: open, JSON body, close.
    const events = [
      assistant(SENTINEL_OPEN),
      assistant(VALID_NODE_JSON),
      assistant(SENTINEL_CLOSE),
    ];
    const out = await drain(events);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('node');
  });
});

describe('extractNodes — error paths', () => {
  it('test_extractNodes_yields_malformed_json_error', async () => {
    const out = await drain([assistant(`${SENTINEL_OPEN}{not valid json${SENTINEL_CLOSE}`)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'error', reason: 'malformed-json' });
  });

  it('test_extractNodes_yields_not_an_object_error', async () => {
    const out = await drain([assistant(`${SENTINEL_OPEN}42${SENTINEL_CLOSE}`)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'error', reason: 'not-an-object' });
  });

  it('test_extractNodes_yields_validation_failed_error', async () => {
    // Missing every required field.
    const out = await drain([assistant(`${SENTINEL_OPEN}{}${SENTINEL_CLOSE}`)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('error');
    if (out[0]?.kind === 'error') {
      expect(out[0].reason).toBe('validation-failed');
      expect(out[0].detail).toContain('id must be a string');
    }
  });

  it('test_extractNodes_continues_after_error_block', async () => {
    const text = `${SENTINEL_OPEN}{}${SENTINEL_CLOSE}prose${block(VALID_NODE_JSON)}`;
    const out = await drain([assistant(text)]);
    expect(out).toHaveLength(2);
    expect(out[0]?.kind).toBe('error');
    expect(out[1]?.kind).toBe('node');
  });

  it('test_extractNodes_yields_runaway_sentinel_on_no_close', async () => {
    // Open without close, padded over 64KB so the cap fires.
    const huge = SENTINEL_OPEN + 'x'.repeat(70_000);
    const out = await drain([assistant(huge)]);
    expect(out.some((r) => r.kind === 'error' && r.reason === 'runaway-sentinel')).toBe(true);
  });

  it('test_extractNodes_silently_discards_unclosed_buffer_at_end_of_stream', async () => {
    // Open sentinel followed by partial JSON, then iterator ends — no node
    // should be yielded. Also no error: the contract is "discard partial".
    const out = await drain([assistant(SENTINEL_OPEN + '{"id":"n1"')]);
    expect(out).toHaveLength(0);
  });
});

describe('extractNodes — non-assistant and empty events', () => {
  it('test_extractNodes_skips_system_and_result_events', async () => {
    const systemEv: ClaudeEvent = {
      type: 'system',
      subtype: 'init',
      session_id: 's',
      model: 'haiku',
      raw: {},
    };
    const resultEv: ClaudeEvent = {
      type: 'result',
      subtype: 'success',
      session_id: 's',
      is_error: false,
      raw: {},
    };
    const out = await drain([systemEv, assistant(block(VALID_NODE_JSON)), resultEv]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('node');
  });

  it('test_extractNodes_skips_non_text_content_blocks', async () => {
    // An assistant event whose content has only tool_use and other blocks
    // must yield nothing.
    const ev: AssistantEvent = {
      type: 'assistant',
      session_id: 's',
      content: [
        { type: 'tool_use', id: 't1', name: 'noop', input: {} },
        { type: 'thinking', raw: {} },
      ],
      raw: {},
    };
    const out = await drain([ev]);
    expect(out).toHaveLength(0);
  });

  it('test_extractNodes_empty_iterator_yields_nothing', async () => {
    const out = await drain([]);
    expect(out).toHaveLength(0);
  });
});
