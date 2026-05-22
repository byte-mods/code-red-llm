/**
 * Admin route for flow simulation.
 *
 *   POST /no-code-red/simulate  → JSON { ok, trace, error? }
 *
 * Body: { nodes: SimNode[], startNodeId: string, msg?: object }
 */
import type { Request, Response } from '../types.js';
import { simulateFlow } from './engine.js';
import type { SimNode } from './types.js';

export async function handleSimulate(req: Request, res: Response): Promise<void> {
  const body = (req as unknown as { body?: { nodes?: unknown[]; startNodeId?: string; msg?: Record<string, unknown> } }).body;
  const nodes = Array.isArray(body?.nodes) ? (body.nodes as SimNode[]) : [];
  const startNodeId = typeof body?.startNodeId === 'string' ? body.startNodeId : '';
  const msg = typeof body?.msg === 'object' && body.msg !== null ? body.msg : { payload: {} };

  if (nodes.length === 0) {
    res.status(400).json({ error: 'body.nodes array is required' });
    return;
  }
  if (startNodeId === '') {
    res.status(400).json({ error: 'body.startNodeId is required' });
    return;
  }

  try {
    const result = await simulateFlow(nodes, startNodeId, msg);
    res.json(result);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, trace: [], error: `simulation crashed: ${detail}` });
  }
}
