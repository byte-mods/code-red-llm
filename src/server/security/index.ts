/**
 * Security middleware for no_code_red admin routes.
 *
 * When `NO_CODE_RED_API_KEY` is set in the environment, every admin route
 * (except `/health`) requires a matching `X-API-Key` header. When the env
 * var is absent, the middleware is a no-op — permissive by default so local
 * development does not break.
 */
import type { Request, Response, NextFunction } from '../types.js';

const API_KEY = process.env['NO_CODE_RED_API_KEY'];
const AUTH_ENABLED = typeof API_KEY === 'string' && API_KEY.length > 0;

/** Check if a request carries a valid API key. */
function isAuthorized(req: Request): boolean {
  const header = req.headers['x-api-key'];
  return typeof header === 'string' && header === API_KEY;
}

/**
 * Express-style middleware. If auth is enabled and the request lacks a valid
 * key, responds with 401 and short-circuits. Otherwise calls `next()`.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED) {
    next();
    return;
  }
  if (isAuthorized(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized', detail: 'valid X-API-Key header required' });
}

/** True when the API key guard is active. Exported for tests and diagnostics. */
export function isAuthEnabled(): boolean {
  return AUTH_ENABLED;
}
