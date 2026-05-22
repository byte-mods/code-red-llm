/**
 * Hand-rolled Node-RED node validator.
 *
 * Contract: `validateNode(raw)` never throws. It accepts unknown input
 * (anything that fell out of `JSON.parse`) and returns either a narrowed
 * `NodeRedNode` or the full list of structured error messages so the SSE
 * layer (S4) can surface them all to the editor.
 *
 * Why hand-rolled instead of zod / valibot: the required surface is five
 * fields and ~thirty lines of checking. A 30KB dependency for this is
 * over-fitting; if validation grows past ~5 fields, revisit (see code-map
 * follow-ups).
 *
 * What we deliberately do NOT validate:
 *  - Cross-node references (every id in `wires` must eventually appear as
 *    some node's id). That is a graph-level invariant for a later section
 *    — the extractor sees nodes one at a time and cannot know.
 *  - Domain-specific shapes inside `extras` (e.g. `inject.props`,
 *    `http_request.url`). Node-RED itself validates those at insert.
 *  - Sentinel bytes around the JSON — that is the extractor's job.
 *
 * Errors are returned in deterministic order (the order required fields
 * are checked), so tests can assert specific messages without flakiness.
 */
import type { NodeRedNode, ValidationResult } from './types.js';

/** Required field list, kept in lockstep with the prompt template. */
const REQUIRED_KEYS = ['id', 'type', 'x', 'y', 'wires'] as const;

/**
 * Type guard for a plain object: a non-null object that is not an array.
 * `typeof null === 'object'` so the null check is mandatory.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates that `wires` is `string[][]`. Returns null on success, an error
 * message on failure. Walks every inner element so a single rogue value
 * produces a precise message ("wires[1][0] is not a string"), not a vague
 * "wires is invalid".
 */
function checkWires(value: unknown): string | null {
  if (!Array.isArray(value)) return 'wires must be an array';
  for (let i = 0; i < value.length; i++) {
    const inner = value[i];
    if (!Array.isArray(inner)) return `wires[${String(i)}] must be an array`;
    for (let j = 0; j < inner.length; j++) {
      if (typeof inner[j] !== 'string') {
        return `wires[${String(i)}][${String(j)}] must be a string`;
      }
    }
  }
  return null;
}

/**
 * Validate a single Node-RED node candidate. Aggregates every defect
 * rather than short-circuiting at the first one — the editor can then
 * display the full list to the user, who fixes everything in one round.
 */
/**
 * Narrow `raw[key]` to a string at the variable level, accumulating a typed
 * error if the field is absent or wrong. Returns the narrowed value or
 * undefined; callers check via the `errors` length, not the return.
 */
function takeString(
  raw: Record<string, unknown>,
  key: string,
  errors: string[],
): string | undefined {
  const v = raw[key];
  if (typeof v !== 'string') {
    errors.push(`${key} must be a string`);
    return undefined;
  }
  return v;
}

/** Same idea for a finite number. */
function takeFiniteNumber(
  raw: Record<string, unknown>,
  key: string,
  errors: string[],
): number | undefined {
  const v = raw[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(`${key} must be a finite number`);
    return undefined;
  }
  return v;
}

/**
 * Narrow `raw.wires` to `string[][]` or push a single precise error.
 * Returns the narrowed array or undefined.
 */
function takeWires(
  raw: Record<string, unknown>,
  errors: string[],
): ReadonlyArray<ReadonlyArray<string>> | undefined {
  const value = raw['wires'];
  const err = checkWires(value);
  if (err !== null) {
    errors.push(err);
    return undefined;
  }
  // checkWires walked every cell; we know the shape is string[][] now.
  // Re-validate at the boundary so the narrowing is observable to TS
  // without an `as` cast.
  if (!Array.isArray(value)) return undefined;
  const out: string[][] = [];
  for (const inner of value) {
    if (!Array.isArray(inner)) return undefined;
    const row: string[] = [];
    for (const cell of inner) {
      if (typeof cell !== 'string') return undefined;
      row.push(cell);
    }
    out.push(row);
  }
  return out;
}

export function validateNode(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['node must be a JSON object'] };
  }

  const errors: string[] = [];

  const id = takeString(raw, 'id', errors);
  const type = takeString(raw, 'type', errors);
  const x = takeFiniteNumber(raw, 'x', errors);
  const y = takeFiniteNumber(raw, 'y', errors);
  const wires = takeWires(raw, errors);

  // Optional fields: only complain if present-but-wrong-type.
  let name: string | undefined;
  if (raw['name'] !== undefined) {
    if (typeof raw['name'] !== 'string') {
      errors.push('name must be a string when present');
    } else {
      name = raw['name'];
    }
  }
  let z: string | undefined;
  if (raw['z'] !== undefined) {
    if (typeof raw['z'] !== 'string') {
      errors.push('z must be a string when present');
    } else {
      z = raw['z'];
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  // Below this point, every required field is defined (its absence would
  // have pushed an error). TS cannot follow the cross-field invariant, so
  // we test explicitly — the runtime checks are redundant but keep the
  // narrowing zero-cast.
  if (id === undefined || type === undefined || x === undefined || y === undefined || wires === undefined) {
    return { ok: false, errors: ['internal: required field missing after validation'] };
  }

  const extras: Record<string, unknown> = {};
  const consumed = new Set<string>([...REQUIRED_KEYS, 'name', 'z']);
  for (const key of Object.keys(raw)) {
    if (!consumed.has(key)) extras[key] = raw[key];
  }

  const node: NodeRedNode = {
    id,
    type,
    x,
    y,
    wires,
    ...(name !== undefined ? { name } : {}),
    ...(z !== undefined ? { z } : {}),
    extras,
  };
  return { ok: true, node };
}
