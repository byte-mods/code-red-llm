/**
 * Node-RED node: map
 *
 * Transform fields, add/remove fields, compute expressions.
 * This is the TIBCO StreamBase Map operator retrofitted onto
 * Node-RED messages.
 *
 * Config:
 *   rules — JSON array of { field, expression } objects
 *
 * Behavior:
 *   - Evaluates each expression against the incoming msg.
 *   - Assigns the result to msg[field].
 *   - Passes the transformed msg downstream.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString } from './helpers.js';

const NODE_TYPE = 'map';

interface MapRule {
  readonly field: string;
  readonly expression: string;
}

function parseRules(raw: string): MapRule[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const out: MapRule[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) return undefined;
      const field = item['field'];
      const expression = item['expression'];
      if (typeof field !== 'string' || typeof expression !== 'string') return undefined;
      out.push({ field, expression });
    }
    return out;
  } catch {
    return undefined;
  }
}

function makeTransformer(src: string): (msg: NodeMessage) => unknown {
  try {
    const fn = new Function('msg', `return (${src});`);
    return (msg) => {
      try {
        return fn(msg);
      } catch {
        return undefined;
      }
    };
  } catch {
    return () => undefined;
  }
}

const mapNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const rulesRaw = cfgString(config, 'rules') ?? '[]';
    const rules = parseRules(rulesRaw);

    if (rules === undefined) {
      node.status({ fill: 'red', shape: 'ring', text: 'bad rules' });
      return;
    }

    const transformers = rules.map((r) => ({ field: r.field, fn: makeTransformer(r.expression) }));

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const m = msg as Record<string, unknown>;
        for (const t of transformers) {
          m[t.field] = t.fn(msg);
        }
        node.send(msg);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
};

export default mapNode;
