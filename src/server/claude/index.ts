/**
 * Barrel for the Claude subprocess bridge. Public surface lives under
 * `src/server/claude/`; downstream code (S4 SSE writer, future consumers)
 * imports from this file only.
 *
 * S2.T1 ships the parser + event types. S2.T2 will add `spawnClaude`; S2.T3
 * will extend it with cancel + timeout.
 */
export * from './events.js';
export { parseEvent } from './parser.js';
export type { ParseError, ParseResult } from './parser.js';
export { spawnClaude, buildClaudeArgs } from './spawn.js';
export type {
  SpawnClaudeOptions,
  ClaudeSession,
  ClaudeExit,
  ClaudeSessionStats,
  CancelReason,
} from './spawn.js';
