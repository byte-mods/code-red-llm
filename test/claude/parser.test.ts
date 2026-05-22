/**
 * Unit tests for `src/server/claude/parser.ts`.
 *
 * Coverage targets:
 *  - Round-trip both recorded fixtures (success + error transcripts).
 *  - Per-variant narrowing: system/init, assistant (with text + tool_use +
 *    tool_result + other blocks), user, result (error + non-error),
 *    stream_event, unknown-type forward-compat.
 *  - Negative paths: malformed JSON, non-object top-level, missing `type`.
 *  - Lenient paths: empty lines and whitespace-only lines yield null events.
 *
 * Naming: test_parser_<scenario>_<expected_behavior>.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseEvent,
  type AssistantEvent,
  type ClaudeEvent,
  type ResultEvent,
  type StreamEvent,
  type SystemInitEvent,
  type ToolUseBlock,
  type UnknownEvent,
  type UserEvent,
} from '../../src/server/claude/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dir, '../fixtures');

/** Load and parse a fixture file into a list of events, asserting all parses succeed. */
function loadFixture(name: string): ClaudeEvent[] {
  const path = resolve(fixturesDir, name);
  const raw = readFileSync(path, 'utf-8');
  const events: ClaudeEvent[] = [];
  for (const line of raw.split('\n')) {
    const r = parseEvent(line);
    expect(r.ok, `parse failed on line: ${line}`).toBe(true);
    if (r.ok && r.event !== null) events.push(r.event);
  }
  return events;
}

describe('parser — fixtures round-trip', () => {
  it('test_parser_parses_recorded_success_transcript', () => {
    const events = loadFixture('claude-stream-success.jsonl');
    expect(events).toHaveLength(5);
    expect(events[0]!.type).toBe('system');
    expect(events[1]!.type).toBe('assistant');
    expect(events[2]!.type).toBe('user');
    expect(events[3]!.type).toBe('stream_event');
    expect(events[4]!.type).toBe('result');
  });

  it('test_parser_parses_recorded_auth_error_transcript', () => {
    const events = loadFixture('claude-stream-error.jsonl');
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe('system');

    const assistantEv = events[1] as AssistantEvent;
    expect(assistantEv.type).toBe('assistant');
    expect(assistantEv.error).toBe('authentication_failed');

    const resultEv = events[2] as ResultEvent;
    expect(resultEv.type).toBe('result');
    expect(resultEv.is_error).toBe(true);
  });
});

describe('parser — variant narrowing', () => {
  it('test_parser_narrows_system_init_with_session_and_model', () => {
    const r = parseEvent(
      '{"type":"system","subtype":"init","session_id":"abc","model":"haiku","cwd":"/x"}',
    );
    expect(r.ok).toBe(true);
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as SystemInitEvent;
    expect(ev.type).toBe('system');
    expect(ev.subtype).toBe('init');
    expect(ev.session_id).toBe('abc');
    expect(ev.model).toBe('haiku');
    expect(ev.cwd).toBe('/x');
  });

  it('test_parser_extracts_assistant_content_blocks_in_order', () => {
    const r = parseEvent(
      JSON.stringify({
        type: 'assistant',
        session_id: 's',
        uuid: 'u',
        message: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 't1', name: 'emit_node', input: { foo: 1 } },
            { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
            { type: 'thinking', thinking: 'redacted' },
          ],
          stop_reason: 'end_turn',
        },
      }),
    );
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as AssistantEvent;
    expect(ev.content).toHaveLength(4);
    expect(ev.content[0]).toEqual({ type: 'text', text: 'hello' });
    const tu = ev.content[1] as ToolUseBlock;
    expect(tu.type).toBe('tool_use');
    expect(tu.name).toBe('emit_node');
    expect(tu.input).toEqual({ foo: 1 });
    expect(ev.content[2]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', content: 'ok' });
    // Unknown block kind is kept under OtherBlock with the original type tag.
    expect(ev.content[3]!.type).toBe('thinking');
    expect(ev.stop_reason).toBe('end_turn');
  });

  it('test_parser_handles_assistant_without_message_field', () => {
    const r = parseEvent('{"type":"assistant","session_id":"s"}');
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as AssistantEvent;
    expect(ev.content).toEqual([]);
    expect(ev.stop_reason).toBeUndefined();
  });

  it('test_parser_narrows_user_with_tool_results', () => {
    const r = parseEvent(
      '{"type":"user","session_id":"s","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"x"}]}}',
    );
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as UserEvent;
    expect(ev.content).toHaveLength(1);
    expect(ev.content[0]!.type).toBe('tool_result');
  });

  it('test_parser_narrows_result_with_all_optional_fields_present', () => {
    const r = parseEvent(
      '{"type":"result","subtype":"success","is_error":false,"duration_ms":42,"num_turns":3,"total_cost_usd":0.01,"result":"hi","session_id":"s"}',
    );
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as ResultEvent;
    expect(ev.is_error).toBe(false);
    expect(ev.duration_ms).toBe(42);
    expect(ev.num_turns).toBe(3);
    expect(ev.total_cost_usd).toBe(0.01);
    expect(ev.result).toBe('hi');
  });

  it('test_parser_narrows_result_with_is_error_true', () => {
    const r = parseEvent('{"type":"result","subtype":"success","is_error":true,"session_id":"s"}');
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as ResultEvent;
    expect(ev.is_error).toBe(true);
  });

  it('test_parser_narrows_stream_event_preserving_inner_event', () => {
    const r = parseEvent(
      '{"type":"stream_event","session_id":"s","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}}',
    );
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as StreamEvent;
    expect(ev.event['type']).toBe('content_block_delta');
  });
});

describe('parser — forward compat', () => {
  it('test_parser_tags_unknown_event_type', () => {
    const r = parseEvent('{"type":"future_event_kind","payload":42}');
    if (!r.ok || !r.event) throw new Error('unreachable');
    const ev = r.event as UnknownEvent;
    expect(ev.type).toBe('__unknown__');
    expect(ev.originalType).toBe('future_event_kind');
    expect(ev.raw['payload']).toBe(42);
  });

  it('test_parser_treats_system_without_subtype_as_unknown', () => {
    const r = parseEvent('{"type":"system"}');
    if (!r.ok || !r.event) throw new Error('unreachable');
    expect(r.event.type).toBe('__unknown__');
  });
});

describe('parser — negative paths', () => {
  it('test_parser_returns_parse_error_on_malformed_json', () => {
    const r = parseEvent('{not valid json');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('malformed-json');
    expect(r.error.rawLine).toBe('{not valid json');
  });

  it('test_parser_returns_parse_error_on_non_object_payload', () => {
    const r = parseEvent('42');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('not-an-object');
  });

  it('test_parser_returns_parse_error_on_array_payload', () => {
    const r = parseEvent('[1,2,3]');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('not-an-object');
  });

  it('test_parser_returns_parse_error_on_missing_type', () => {
    const r = parseEvent('{"session_id":"x"}');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('missing-type');
  });
});

describe('parser — lenient paths', () => {
  it('test_parser_returns_null_event_for_empty_line', () => {
    const r = parseEvent('');
    if (!r.ok) throw new Error('unreachable');
    expect(r.event).toBeNull();
  });

  it('test_parser_returns_null_event_for_whitespace_line', () => {
    const r = parseEvent('   \t  ');
    if (!r.ok) throw new Error('unreachable');
    expect(r.event).toBeNull();
  });

  it('test_parser_does_not_throw_on_pathological_input', () => {
    // Crafted to look like JSON but trip the tokenizer mid-parse.
    expect(() => parseEvent('{"type":"a","x":}')).not.toThrow();
  });
});
