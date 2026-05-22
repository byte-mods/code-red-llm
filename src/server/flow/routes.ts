/**
 * Admin route for the flow validator.
 *
 *   POST /no-code-red/validate  → JSON { ok, issues }
 *
 * Body: { nodes: unknown[] }
 *
 * This lets the client call the same pure validator the server uses,
 * avoiding a divergent fork of the validation logic.
 */
import type { Request, Response } from '../types.js';
import { validateFlow } from './validator.js';

export function handleValidate(req: Request, res: Response): void {
  const body = (req as unknown as { body?: { nodes?: unknown[] } }).body;
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const result = validateFlow(nodes);
  res.json(result);
}
