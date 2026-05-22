/**
 * In-memory registry of active claude generations.
 *
 * Responsibilities:
 *   - Track every in-flight generation by id so a separate route can
 *     cancel one without holding a closure over the original request.
 *   - Enforce a bounded concurrency cap. Beyond `maxConcurrent` the
 *     caller gets `null` from `tryAcquire` and is expected to surface a
 *     503 to the client (or a structured SSE `error` frame if the
 *     headers have already flushed).
 *   - Expose a snapshot list for the `GET /generations` route.
 *
 * Out of scope: cross-process registry (S6 only targets single-process).
 * Multi-replica deployments are a future concern — the registry is
 * deliberately not persisted to disk; on restart, all in-flight
 * generations are lost (the client will see EventSource reconnect
 * attempts and a fresh stream when it retries).
 *
 * Concurrency model: registry is a single Map; mutations happen on the
 * main thread (Node.js single-threaded event loop). No locks needed.
 */
import type { ClaudeSession } from '../claude/index.js';

/**
 * One row in the registry. The session ref is held so cancel-by-id
 * works; metadata is kept so the list endpoint does not have to dig
 * into the session.
 */
export interface RegistryEntry {
  readonly id: string;
  readonly prompt: string;
  readonly flowId: string | undefined;
  readonly model: string | undefined;
  readonly startedAt: number;
  readonly session: ClaudeSession;
}

/** What `list()` returns — no session ref so the route serialises cleanly. */
export interface GenerationSummary {
  readonly id: string;
  readonly prompt: string;
  readonly flowId: string | undefined;
  readonly model: string | undefined;
  readonly startedAt: number;
  readonly pid: number | undefined;
}

/** Configuration the registry needs at construction time. */
export interface RegistryOptions {
  readonly maxConcurrent?: number;
}

/** Default cap. Anthropic's CLI authenticates one user at a time per host. */
const DEFAULT_MAX_CONCURRENT = 4;

/**
 * Lightweight class — one instance per plugin load. Exported as a
 * factory so the route layer can inject it for tests.
 */
export class GenerationRegistry {
  private readonly entries: Map<string, RegistryEntry> = new Map();
  private readonly maxConcurrent: number;

  constructor(opts: RegistryOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  /**
   * Reserve a slot. Returns true on success; the caller must call
   * `register` to actually store the entry once the session is built.
   * Two-phase to avoid storing partial entries.
   */
  public tryAcquire(): boolean {
    return this.entries.size < this.maxConcurrent;
  }

  /**
   * Store an entry. The id must be unique; duplicates throw — registry
   * misuse is a programmer error, not a runtime condition.
   */
  public register(entry: RegistryEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`registry: duplicate generation id ${entry.id}`);
    }
    this.entries.set(entry.id, entry);
  }

  /** Look up by id. */
  public get(id: string): RegistryEntry | undefined {
    return this.entries.get(id);
  }

  /** Remove an entry (called when the generation finishes for any reason). */
  public remove(id: string): void {
    this.entries.delete(id);
  }

  /**
   * Snapshot list for the list endpoint. Order is insertion (Map
   * preserves it), so most-recent appears last; the route may reverse
   * for display preference.
   */
  public list(): readonly GenerationSummary[] {
    const out: GenerationSummary[] = [];
    for (const e of this.entries.values()) {
      out.push({
        id: e.id,
        prompt: e.prompt,
        flowId: e.flowId,
        model: e.model,
        startedAt: e.startedAt,
        pid: e.session.pid,
      });
    }
    return out;
  }

  /**
   * Total active generations. Exposed for tests and so the route can
   * surface a Retry-After-style hint when the cap is hit.
   */
  public size(): number {
    return this.entries.size;
  }

  /**
   * Cancel one by id. No-op if the id is unknown or already finished.
   * Returns true iff a session was found and cancel was invoked.
   */
  public cancel(id: string, reason: 'user' | 'shutdown' = 'user'): boolean {
    const e = this.entries.get(id);
    if (e === undefined) return false;
    e.session.cancel(reason);
    return true;
  }

  /** Cancel every active generation. Used by RED.stop() at shutdown. */
  public cancelAll(reason: 'shutdown' = 'shutdown'): void {
    for (const e of this.entries.values()) {
      e.session.cancel(reason);
    }
  }
}
