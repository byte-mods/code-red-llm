/**
 * Admin routes for hot module reload.
 *
 *   POST /no-code-red/reload          → reload every registered node module
 *   POST /no-code-red/reload/:name    → reload just one by type id
 *
 * Both return JSON listing per-node ok/error so the sidebar can show
 * exactly which nodes loaded and which failed.
 */
import type { Request, Response } from '../types.js';
import { reloadAll, reloadType } from './reloader.js';

/**
 * Node-RED 4 throws on re-registration of an existing type id. There
 * is no public `unregisterType` API. We detect the "already registered"
 * case and rewrite the hint so the operator understands the constraint:
 *   - hot reload WORKS for first-time registration (new custom nodes)
 *   - hot reload FAILS for already-loaded types (need server restart)
 */
function buildHint(results: ReadonlyArray<{ ok: boolean; error?: string }>): string {
  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) {
    return 'All node modules re-registered. Hard-refresh the editor (Cmd-Shift-R) for HTML/palette changes; then re-deploy flows.';
  }
  const allAlreadyRegistered = failures.every((r) => typeof r.error === 'string' && r.error.includes('already registered'));
  if (allAlreadyRegistered) {
    return 'Node-RED 4 does not allow re-registering an existing type id. Hot reload supports first-time registration only (new custom nodes). Restart the server to update already-loaded types.';
  }
  return `${String(failures.length)} module(s) failed — see per-result errors.`;
}

export async function handleReloadAll(_req: Request, res: Response): Promise<void> {
  const results = await reloadAll();
  const okCount = results.filter((r) => r.ok).length;
  res.json({
    ok: results.every((r) => r.ok),
    okCount,
    total: results.length,
    results,
    hint: buildHint(results),
  });
}

export async function handleReloadOne(req: Request, res: Response): Promise<void> {
  const name = (req.params as Record<string, string> | undefined)?.['name'];
  if (typeof name !== 'string' || name === '') {
    res.status(400).json({ error: 'path param :name required' });
    return;
  }
  const result = await reloadType(name);
  res.status(result.ok ? 200 : 500).json({
    ...result,
    ...(result.ok ? { hint: 'Re-deploy the flow to make existing instances pick up the new code.' } : {}),
  });
}
