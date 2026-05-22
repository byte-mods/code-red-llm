/**
 * Wire-type validator.
 *
 * Checks that upstream output schemas are compatible with downstream
 * input expectations for every wire in a flow. Pure function — never
 * throws; malformed inputs are silently skipped.
 */
import { checkSchemaCompat } from '../schemas/compat.js';
import type { SchemaDefinition } from '../extractor/types.js';

export interface WireTypeIssue {
  /** The offending source node id. */
  readonly nodeId: string;
  readonly type: 'type-mismatch';
  readonly detail: string;
}

export interface WireTypeValidationResult {
  readonly ok: boolean;
  readonly issues: readonly WireTypeIssue[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/** Extract `id` from a loosely-typed node candidate. */
function nodeId(n: unknown): string | undefined {
  return isObj(n) && typeof n['id'] === 'string' ? n['id'] : undefined;
}

/** Extract `type` from a loosely-typed node candidate. */
function nodeType(n: unknown): string | undefined {
  return isObj(n) && typeof n['type'] === 'string' ? n['type'] : undefined;
}

/** Extract `wires` as a 2-D array of strings from a loosely-typed node. */
function nodeWires(n: unknown): string[][] {
  if (!isObj(n)) return [];
  const w = n['wires'];
  if (!Array.isArray(w)) return [];
  const out: string[][] = [];
  for (const port of w) {
    if (!Array.isArray(port)) { out.push([]); continue; }
    const p: string[] = [];
    for (const t of port) {
      if (typeof t === 'string') p.push(t);
    }
    out.push(p);
  }
  return out;
}

/**
 * Parse a schema node's `definition` config into a field→type map.
 * Returns `undefined` if the node is not a schema node or has an
 * unparsable / non-object definition.
 */
function parseNodeInputSchema(n: unknown): Record<string, string> | undefined {
  if (nodeType(n) !== 'schema') return undefined;
  if (!isObj(n)) return undefined;
  const definition =
    typeof n['definition'] === 'string'
      ? n['definition']
      : isObj(n['extras']) && typeof n['extras']['definition'] === 'string'
        ? n['extras']['definition']
        : undefined;
  if (definition === undefined) return undefined;
  try {
    const parsed = JSON.parse(definition);
    if (!isObj(parsed) || Array.isArray(parsed)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') return undefined;
      out[key] = value;
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Validate wire types for a batch of nodes.
 *
 * @param nodes — node candidates (from client or extractor). Only nodes
 *   with a string `id` and `wires` are considered.
 * @param schemas — output schemas emitted by the LLM, keyed by `nodeId`.
 *   Only schemas whose `nodeId` matches a node in `nodes` are used.
 */
export function validateWireTypes(
  nodes: readonly unknown[],
  schemas: readonly SchemaDefinition[],
): WireTypeValidationResult {
  const issues: WireTypeIssue[] = [];

  // Build output schema map: nodeId -> fields
  const outputSchemas = new Map<string, Readonly<Record<string, string>>>();
  for (const s of schemas) {
    outputSchemas.set(s.nodeId, s.fields);
  }

  // Build node map: id -> raw node (for target lookup)
  const nodeMap = new Map<string, unknown>();
  for (const n of nodes) {
    const id = nodeId(n);
    if (id !== undefined) nodeMap.set(id, n);
  }

  for (const source of nodes) {
    const sid = nodeId(source);
    if (sid === undefined) continue;
    const sourceSchema = outputSchemas.get(sid);
    if (sourceSchema === undefined) continue;

    const wires = nodeWires(source);
    for (let portIdx = 0; portIdx < wires.length; portIdx++) {
      const port = wires[portIdx];
      if (port === undefined) continue;
      for (const targetId of port) {
        const target = nodeMap.get(targetId);
        if (target === undefined) continue;
        const targetSchema = parseNodeInputSchema(target);
        if (targetSchema === undefined) continue;
        const errors = checkSchemaCompat(sourceSchema, targetSchema);
        if (errors.length > 0) {
          issues.push({
            nodeId: sid,
            type: 'type-mismatch',
            detail: `wire ${sid}[${String(portIdx)}] → ${targetId}: ${errors.join('; ')}`,
          });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
