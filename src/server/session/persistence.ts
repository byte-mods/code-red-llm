/**
 * Append-only persistence for generation history.
 *
 * Layout under the project's working dir:
 *   .no-code-red/history/<YYYY-MM-DD>/<generation-id>.jsonl
 *
 * Each generation gets its own JSONL file so listing is cheap (just
 * walk the dir) and a single corrupted file does not poison the others.
 * Each line is one event of shape:
 *   { ts, kind: 'meta' | 'node' | 'error' | 'done', data: ... }
 *
 * Why JSONL: streaming-friendly (we append as events arrive), easy to
 * tail with `cat`, no schema migration as we add fields. The route layer
 * may parse later if it adds a replay endpoint; for S6 we only WRITE.
 *
 * Concurrency: single-writer per file (one generation owns one file).
 * Across generations, fs.appendFile serialises through libuv. No locks
 * needed.
 *
 * Best-effort: I/O errors are logged via the provided sink and
 * swallowed. Persistence MUST NOT break the live SSE stream — losing a
 * history line is preferable to dropping a node frame on the client.
 */
import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Per-event record persisted to disk. */
export interface HistoryRecord {
  readonly ts: number;
  readonly kind: 'meta' | 'node' | 'error' | 'done';
  readonly data: unknown;
}

/** A sink that swallows I/O errors so persistence never throws past the writer. */
export interface ErrorSink {
  (err: Error): void;
}

/**
 * Append-only writer scoped to one generation. Construct once at the
 * start of a generation; call `record` for every event; the route is
 * not required to explicitly close (the file handle is opened/closed
 * per append via fs.appendFile).
 */
export class HistoryWriter {
  private readonly filePath: string;
  private readonly onError: ErrorSink;
  private dirEnsured = false;

  constructor(rootDir: string, generationId: string, onError: ErrorSink) {
    const day = new Date().toISOString().slice(0, 10);
    this.filePath = join(rootDir, 'history', day, `${generationId}.jsonl`);
    this.onError = onError;
  }

  /**
   * Append one record. Returns a promise the caller may await for
   * back-pressure but is generally fire-and-forget — the writer
   * traps any error so callers do not need a try/catch.
   */
  public async record(kind: HistoryRecord['kind'], data: unknown): Promise<void> {
    const rec: HistoryRecord = { ts: Date.now(), kind, data };
    const line = JSON.stringify(rec) + '\n';
    try {
      if (!this.dirEnsured) {
        await mkdir(dirname(this.filePath), { recursive: true });
        this.dirEnsured = true;
      }
      await appendFile(this.filePath, line, 'utf-8');
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.onError(err);
    }
  }

  /** Path of the file being written. Exposed for tests. */
  public path(): string {
    return this.filePath;
  }
}
