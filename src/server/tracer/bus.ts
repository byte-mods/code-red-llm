/**
 * Singleton coordination point between live tracer nodes and the admin
 * routes / sidebar that drive them.
 *
 * Why a module-level singleton: tracer nodes load via Node-RED's normal
 * registration path (one per deployed `tracer` instance) and the SSE
 * route mounts once at plugin load. Both sides need a shared rendezvous
 * — passing a constructed instance through Node-RED's node loader is
 * not straightforward, so a process-global singleton is the simplest
 * fit. Single-process scope (S6 invariant) means no cross-process
 * coordination is needed yet.
 *
 * Concurrency: Node.js is single-threaded — every mutation runs on the
 * event loop. No locks.
 */
import { EventEmitter } from 'node:events';

import type { NodeMessage } from '../nodes/red-runtime.js';

export type TracerMode = 'running' | 'paused';

export interface HeldMessage {
  /** Stable sequence id within a tracer (1-based, monotonic). */
  readonly seq: number;
  /** Wall-clock arrival time. */
  readonly receivedAt: number;
  /** The actual msg being held; released verbatim. */
  readonly msg: NodeMessage;
}

export interface TracerSnapshot {
  readonly id: string;
  readonly name: string | undefined;
  readonly mode: TracerMode;
  readonly heldCount: number;
  readonly seenCount: number;
  /** Bounded recent log of msgs (held or passed) for the sidebar to display. */
  readonly recent: ReadonlyArray<{ readonly seq: number; readonly receivedAt: number; readonly preview: string; readonly held: boolean }>;
}

/** Internal mutable state — never exposed directly. */
interface TracerRow {
  id: string;
  name: string | undefined;
  mode: TracerMode;
  seenCount: number;
  /** Queue of held messages awaiting release. */
  held: HeldMessage[];
  /** Bounded recent log for the sidebar — always tail-trimmed. */
  recent: TracerSnapshot['recent'][number][];
  /** Callback the node hands us so the bus can release msgs back through it. */
  releaseHook: (msg: NodeMessage) => void;
}

const MAX_RECENT = 50;

function previewPayload(msg: NodeMessage): string {
  const p = msg.payload;
  try {
    const s = typeof p === 'string' ? p : JSON.stringify(p);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  } catch {
    return String(p);
  }
}

class TracerBus extends EventEmitter {
  private readonly rows: Map<string, TracerRow> = new Map();

  /** Tracer node registers itself at construction. */
  register(id: string, name: string | undefined, initialMode: TracerMode, releaseHook: (msg: NodeMessage) => void): void {
    this.rows.set(id, {
      id, name,
      mode: initialMode,
      seenCount: 0,
      held: [],
      recent: [],
      releaseHook,
    });
    this.emit('registered', this.snapshot(id));
  }

  /** Tracer node unregisters at close. */
  unregister(id: string): void {
    if (!this.rows.delete(id)) return;
    this.emit('unregistered', id);
  }

  /**
   * Called by the tracer node on each incoming msg. Returns true if the
   * msg should be released downstream immediately; false if the bus is
   * holding it (the node forgets about it — the bus owns release).
   */
  ingest(id: string, msg: NodeMessage): boolean {
    const row = this.rows.get(id);
    if (row === undefined) return true; // unknown tracer — fail-open
    row.seenCount += 1;
    const seq = row.seenCount;
    const held = row.mode === 'paused';
    const item = { seq, receivedAt: Date.now(), preview: previewPayload(msg), held };
    row.recent.push(item);
    if (row.recent.length > MAX_RECENT) row.recent.splice(0, row.recent.length - MAX_RECENT);
    if (held) {
      row.held.push({ seq, receivedAt: item.receivedAt, msg });
    }
    this.emit('changed', this.snapshot(id));
    return !held;
  }

  /** Switch a tracer to running. Pending held msgs are released in order. */
  resume(id: string): boolean {
    const row = this.rows.get(id);
    if (row === undefined) return false;
    row.mode = 'running';
    const queue = row.held;
    row.held = [];
    for (const h of queue) row.releaseHook(h.msg);
    this.emit('changed', this.snapshot(id));
    return true;
  }

  pause(id: string): boolean {
    const row = this.rows.get(id);
    if (row === undefined) return false;
    row.mode = 'paused';
    this.emit('changed', this.snapshot(id));
    return true;
  }

  /** Release exactly one held msg (FIFO). Stays paused. */
  step(id: string): boolean {
    const row = this.rows.get(id);
    if (row === undefined) return false;
    const next = row.held.shift();
    if (next === undefined) return false;
    row.releaseHook(next.msg);
    this.emit('changed', this.snapshot(id));
    return true;
  }

  snapshot(id: string): TracerSnapshot | undefined {
    const row = this.rows.get(id);
    if (row === undefined) return undefined;
    return {
      id: row.id, name: row.name, mode: row.mode,
      heldCount: row.held.length, seenCount: row.seenCount,
      recent: row.recent.slice(),
    };
  }

  list(): TracerSnapshot[] {
    return [...this.rows.keys()].map((id) => this.snapshot(id)).filter((s): s is TracerSnapshot => s !== undefined);
  }
}

/** Process-global singleton. */
export const tracerBus = new TracerBus();
