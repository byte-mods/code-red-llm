/**
 * Structural flow validator.
 *
 * Checks a batch of generated nodes for integrity problems that would
 * cause the Node-RED editor to mis-render or silently drop wires.
 * Pure function — no RED runtime dependency.
 *
 * The optional `existingIds` set lets the client include nodes already
 * on the canvas as valid wire targets, so a partial refinement that
 * wires into an existing node is not flagged as dangling.
 */

import type { NodeRedNode } from '../extractor/types.js';

export interface FlowIssue {
  /** The offending node id, or '*' for global issues. */
  readonly nodeId: string;
  /** Machine-readable category. */
  readonly type: 'duplicate-id' | 'dangling-wire' | 'self-wire' | 'bad-coordinate' | 'bad-wires-shape';
  /** Human-readable explanation. */
  readonly detail: string;
}

export interface FlowValidationResult {
  readonly ok: boolean;
  readonly issues: readonly FlowIssue[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/**
 * Validate an array of nodes. Never throws — every input shape produces
 * a result (possibly with `bad-wires-shape` issues for malformed nodes).
 */
export function validateFlow(
  nodes: readonly unknown[] | null | undefined,
  existingIds?: ReadonlySet<string> | null,
): FlowValidationResult {
  try {
    return _validateFlowUnsafe(nodes, existingIds);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, issues: [{ nodeId: '*', type: 'bad-wires-shape', detail: `validator crashed: ${detail}` }] };
  }
}

function _validateFlowUnsafe(
  nodes: readonly unknown[] | null | undefined,
  existingIds?: ReadonlySet<string> | null,
): FlowValidationResult {
  const issues: FlowIssue[] = [];
  if (!Array.isArray(nodes)) {
    return { ok: false, issues: [{ nodeId: '*', type: 'bad-wires-shape', detail: 'nodes is not an array' }] };
  }

  // Build id → index map and detect duplicates in one pass.
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!isObj(n)) continue;
    const id = n['id'];
    if (typeof id !== 'string') continue;
    if (idToIndex.has(id)) {
      issues.push({
        nodeId: id,
        type: 'duplicate-id',
        detail: `duplicate node id "${id}" at indices ${String(idToIndex.get(id))} and ${String(i)}`,
      });
    } else {
      idToIndex.set(id, i);
    }
  }

  const validTarget = (targetId: string): boolean => {
    if (idToIndex.has(targetId)) return true;
    if (existingIds !== undefined && existingIds !== null && typeof existingIds.has === 'function') {
      try {
        return existingIds.has(targetId);
      } catch {
        // A misbehaving Set-like object is treated as "not found".
        return false;
      }
    }
    return false;
  };

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!isObj(n)) {
      issues.push({ nodeId: '*', type: 'bad-wires-shape', detail: `node at index ${String(i)} is not an object` });
      continue;
    }
    const obj = n;
    const id = typeof obj['id'] === 'string' ? obj['id'] : `*<index-${String(i)}>`;

    // Coordinate sanity.
    const x = obj['x'];
    const y = obj['y'];
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      issues.push({ nodeId: id, type: 'bad-coordinate', detail: `x is not a finite number (${String(x)})` });
    }
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      issues.push({ nodeId: id, type: 'bad-coordinate', detail: `y is not a finite number (${String(y)})` });
    }

    // Wires shape: array of arrays of strings.
    const wires = obj['wires'];
    if (!Array.isArray(wires)) {
      issues.push({ nodeId: id, type: 'bad-wires-shape', detail: 'wires is not an array' });
      continue;
    }
    for (let portIdx = 0; portIdx < wires.length; portIdx++) {
      const port = wires[portIdx];
      if (!Array.isArray(port)) {
        issues.push({
          nodeId: id,
          type: 'bad-wires-shape',
          detail: `wires[${String(portIdx)}] is not an array`,
        });
        continue;
      }
      for (let wireIdx = 0; wireIdx < port.length; wireIdx++) {
        const targetId = port[wireIdx];
        if (typeof targetId !== 'string') {
          issues.push({
            nodeId: id,
            type: 'bad-wires-shape',
            detail: `wires[${String(portIdx)}][${String(wireIdx)}] is not a string (${String(targetId)})`,
          });
          continue;
        }
        if (targetId === id) {
          issues.push({
            nodeId: id,
            type: 'self-wire',
            detail: `node "${id}" wires to itself on output port ${String(portIdx)}`,
          });
          continue;
        }
        if (!validTarget(targetId)) {
          issues.push({
            nodeId: id,
            type: 'dangling-wire',
            detail: `node "${id}" output port ${String(portIdx)} wires to unknown node "${targetId}"`,
          });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
