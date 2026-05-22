/**
 * Admin routes that complement the streaming /generate endpoint:
 *
 *   GET  /no-code-red/generations        → JSON list of active generations
 *   POST /no-code-red/generations/:id/cancel → request cancel of one
 *
 * Both are plain JSON; the SSE writer is intentionally not involved.
 * The registry is injected so tests can construct one in-process.
 */
import type { Request, Response } from '../types.js';
import type { GenerationRegistry } from '../session/index.js';

export function handleListGenerations(_req: Request, res: Response, registry: GenerationRegistry): void {
  res.json({ generations: registry.list() });
}

export function handleCancelGeneration(req: Request, res: Response, registry: GenerationRegistry): void {
  const id = (req.params as Record<string, string> | undefined)?.['id'];
  if (typeof id !== 'string' || id === '') {
    res.status(400).json({ error: 'path param ":id" is required' });
    return;
  }
  const ok = registry.cancel(id, 'user');
  if (!ok) {
    res.status(404).json({ error: `no active generation with id ${id}` });
    return;
  }
  res.json({ ok: true, id });
}
