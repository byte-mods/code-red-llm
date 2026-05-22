/**
 * Admin route for the flow validator.
 *
 *   POST /no-code-red/validate  → JSON { ok, issues }
 *
 * Body: { nodes: unknown[], schemas?: SchemaDefinition[] }
 *
 * This lets the client call the same pure validator the server uses,
 * avoiding a divergent fork of the validation logic.
 */
import type { Request, Response } from '../types.js';
import { validateFlow } from './validator.js';
import { validateWireTypes } from './wiretypes.js';
import type { SchemaDefinition } from '../extractor/types.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeSchemas(raw: unknown[]): SchemaDefinition[] {
  const out: SchemaDefinition[] = [];
  for (const s of raw) {
    if (!isPlainObject(s)) continue;
    const nodeId = s['nodeId'];
    const fields = s['fields'];
    if (typeof nodeId !== 'string') continue;
    if (!isPlainObject(fields)) continue;
    const validatedFields: Record<string, string> = {};
    let allStrings = true;
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v !== 'string') { allStrings = false; break; }
      validatedFields[k] = v;
    }
    if (allStrings) {
      out.push({ nodeId, fields: validatedFields });
    }
  }
  return out;
}

export function handleValidate(req: Request, res: Response): void {
  const body = (req as unknown as { body?: { nodes?: unknown[]; schemas?: unknown[] } }).body;
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const structural = validateFlow(nodes);

  const rawSchemas = Array.isArray(body?.schemas) ? body.schemas : [];
  const schemas = normalizeSchemas(rawSchemas);

  if (schemas.length > 0) {
    const wire = validateWireTypes(nodes, schemas);
    if (!wire.ok) {
      res.json({ ok: false, issues: [...structural.issues, ...wire.issues] });
      return;
    }
  }

  res.json(structural);
}
