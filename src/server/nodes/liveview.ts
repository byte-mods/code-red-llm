/**
 * Node-RED node: liveview
 *
 * Materializes incoming messages into a queryable in-memory table.
 * This is the TIBCO LiveView concept retrofitted onto Node-RED:
 * a real-time published table that downstream clients can query via REST.
 *
 * Config:
 *   viewName  — shared view identifier
 *   keyField  — optional msg field to use as a row key for upsert semantics
 *
 * Behavior:
 *   - Without keyField: every input message is appended to the view log.
 *   - With keyField: messages upsert by key (most recent wins).
 *   - The view log is bounded to the last 10,000 rows to prevent unbounded growth.
 *
 * Output: passes through unchanged.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString } from './helpers.js';

const NODE_TYPE = 'liveview';
const MAX_ROWS = 10_000;

/** Shared liveview storage: viewName → (key → record) or ordered list. */
const views = new Map<string, { hasKey: boolean; rows: Record<string, unknown>[]; byKey: Map<string, Record<string, unknown>> }>();

function getView(name: string, hasKey: boolean) {
  let v = views.get(name);
  if (v === undefined) {
    v = { hasKey, rows: [], byKey: new Map() };
    views.set(name, v);
  }
  return v;
}

export function getLiveViewSnapshot(name: string): Record<string, unknown>[] {
  const v = views.get(name);
  if (v === undefined) return [];
  if (v.hasKey) return [...v.byKey.values()];
  return [...v.rows];
}

export function listLiveViews(): string[] {
  return [...views.keys()];
}

const liveviewNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const viewName = cfgString(config, 'viewName') ?? 'default';
    const keyField = cfgString(config, 'keyField') ?? '';
    const hasKey = keyField.length > 0;

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const v = getView(viewName, hasKey);
        const m = msg as Record<string, unknown>;

        if (hasKey) {
          const key = String(m[keyField] ?? '');
          if (key !== '') {
            v.byKey.set(key, m);
          }
        } else {
          v.rows.push(m);
          if (v.rows.length > MAX_ROWS) {
            v.rows.shift();
          }
        }

        node.send(msg);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
};

export default liveviewNode;
