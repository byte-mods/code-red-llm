/**
 * Node-RED node: dedupe
 *
 * Drops messages whose `msg[keyField]` (or whole msg.payload) has been
 * seen within `ttlMs`. Useful for idempotency on stream pipelines —
 * sits between a source and the rest of the flow.
 *
 * Config:
 *   keyField  msg path to dedupe on (default: msg.payload itself)
 *   ttlMs     time to remember a key (default 60_000)
 *   maxSize   cap on the cache; LRU-evicted past this
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString } from './helpers.js';

const NODE_TYPE = 'dedupe';

const dedupeNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const keyField = cfgString(config, 'keyField');
    const ttlMs = cfgNumber(config, 'ttlMs') ?? 60_000;
    const maxSize = cfgNumber(config, 'maxSize') ?? 10_000;

    /** Map preserves insertion order so we can do LRU eviction by re-set. */
    const seen = new Map<string, number>();

    function deriveKey(msg: NodeMessage): string {
      if (keyField !== undefined) {
        return String((msg as Record<string, unknown>)[keyField] ?? '');
      }
      const p = msg['payload'];
      return typeof p === 'string' ? p : JSON.stringify(p ?? null);
    }

    const ticker = setInterval(() => {
      const now = Date.now();
      for (const [k, t] of seen) {
        if (now - t > ttlMs) seen.delete(k);
        else break; // insertion-ordered → first non-expired ends sweep
      }
      node.status({ fill: 'blue', shape: 'dot', text: `cache=${seen.size}` });
    }, Math.max(500, Math.floor(ttlMs / 6)));
    ticker.unref();

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const key = deriveKey(msg);
        const now = Date.now();
        const prev = seen.get(key);
        if (prev !== undefined && now - prev <= ttlMs) {
          // Duplicate — drop.
          done();
          return;
        }
        // Insert / refresh.
        seen.delete(key); // ensure we re-insert at end for LRU
        seen.set(key, now);
        if (seen.size > maxSize) {
          // Evict oldest until under cap.
          const it = seen.keys().next();
          if (!it.done) seen.delete(it.value);
        }
        node.send(msg);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });

    node.on('close', (close) => { clearInterval(ticker); close(); });
  });
};

export default dedupeNode;
