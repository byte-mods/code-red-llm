/**
 * Admin routes for the tracer subsystem.
 *
 *   GET    /no-code-red/tracers              — JSON snapshot list
 *   GET    /no-code-red/tracers/events       — SSE stream of changes
 *   POST   /no-code-red/tracers/:id/pause    — flip to paused mode
 *   POST   /no-code-red/tracers/:id/resume   — flip to running + drain
 *   POST   /no-code-red/tracers/:id/step     — release one held msg
 */
import type { Request, Response } from '../types.js';
import { createSseStream } from '../sse/writer.js';
import { tracerBus, type TracerSnapshot } from './bus.js';

export function handleListTracers(_req: Request, res: Response): void {
  res.json({ tracers: tracerBus.list() });
}

/**
 * SSE event stream so the sidebar can update without polling. Emits
 * `snapshot` frames any time a tracer changes (msg arrival, mode flip,
 * register, unregister).
 */
export function handleTracerEvents(_req: Request, res: Response): void {
  const sse = createSseStream(res);
  // First frame: full initial list so the sidebar can paint.
  sse.event('init', { tracers: tracerBus.list() });

  const onChanged = (s: TracerSnapshot): void => {
    if (sse.isClosed()) return;
    sse.event('snapshot', s);
  };
  const onRegistered = (s: TracerSnapshot): void => {
    if (sse.isClosed()) return;
    sse.event('registered', s);
  };
  const onUnregistered = (id: string): void => {
    if (sse.isClosed()) return;
    sse.event('unregistered', { id });
  };

  tracerBus.on('changed', onChanged);
  tracerBus.on('registered', onRegistered);
  tracerBus.on('unregistered', onUnregistered);

  // Heartbeat so idle proxies don't sever the connection.
  const heartbeat = setInterval(() => {
    if (sse.isClosed()) { clearInterval(heartbeat); return; }
    sse.ping();
  }, 15_000);
  heartbeat.unref();

  res.on('close', () => {
    tracerBus.off('changed', onChanged);
    tracerBus.off('registered', onRegistered);
    tracerBus.off('unregistered', onUnregistered);
    clearInterval(heartbeat);
  });
}

function idOr400(req: Request, res: Response): string | null {
  const id = (req.params as Record<string, string> | undefined)?.['id'];
  if (typeof id !== 'string' || id === '') {
    res.status(400).json({ error: 'path param :id required' });
    return null;
  }
  return id;
}

export function handlePauseTracer(req: Request, res: Response): void {
  const id = idOr400(req, res);
  if (id === null) return;
  const ok = tracerBus.pause(id);
  if (!ok) { res.status(404).json({ error: `unknown tracer ${id}` }); return; }
  res.json({ ok: true });
}

export function handleResumeTracer(req: Request, res: Response): void {
  const id = idOr400(req, res);
  if (id === null) return;
  const ok = tracerBus.resume(id);
  if (!ok) { res.status(404).json({ error: `unknown tracer ${id}` }); return; }
  res.json({ ok: true });
}

export function handleStepTracer(req: Request, res: Response): void {
  const id = idOr400(req, res);
  if (id === null) return;
  const ok = tracerBus.step(id);
  if (!ok) { res.status(404).json({ error: `no held msg or unknown tracer ${id}` }); return; }
  res.json({ ok: true });
}
