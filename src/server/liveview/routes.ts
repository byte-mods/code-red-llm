/**
 * REST API for LiveView queryable tables.
 *
 *   GET /no-code-red/liveview        → list view names
 *   GET /no-code-red/liveview/:name  → snapshot of a view
 *
 * No auth beyond the API-key middleware applied in plugin.ts.
 */
import type { Request, Response } from '../types.js';
import { getLiveViewSnapshot, listLiveViews } from '../nodes/liveview.js';

export function handleListLiveViews(_req: Request, res: Response): void {
  res.json({ views: listLiveViews() });
}

export function handleGetLiveView(req: Request, res: Response): void {
  const name = typeof req.params.name === 'string' ? req.params.name : undefined;
  if (name === undefined || name.length === 0) {
    res.status(400).json({ error: 'view name is required' });
    return;
  }
  const snapshot = getLiveViewSnapshot(name);
  res.json({ view: name, count: snapshot.length, rows: snapshot });
}
