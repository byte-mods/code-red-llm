/**
 * Node-RED node: filter
 *
 * Routes tuples based on boolean predicates; multi-port output.
 * This is the TIBCO StreamBase Filter operator retrofitted onto
 * Node-RED messages.
 *
 * Config:
 *   rules — JSON array of predicate strings (e.g. "msg.payload.status === 'active'")
 *
 * Behavior:
 *   - Evaluates each rule in order against the incoming msg.
 *   - Sends the msg to the FIRST port whose predicate is truthy.
 *   - If no predicate matches, sends to the last port (catch-all).
 *   - The node declares outputs = rules.length + 1.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString } from './helpers.js';

const NODE_TYPE = 'filter';

function parseRules(raw: string): string[] | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    if (!parsed.every((r) => typeof r === 'string')) return undefined;
    return parsed as string[];
  } catch {
    return undefined;
  }
}

function makePredicate(src: string): (msg: NodeMessage) => boolean {
  try {
    const fn = new Function('msg', `return (${src});`);
    return (msg) => {
      try {
        return Boolean(fn(msg));
      } catch {
        return false;
      }
    };
  } catch {
    return () => false;
  }
}

const filterNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const rulesRaw = cfgString(config, 'rules') ?? '[]';
    const rules = parseRules(rulesRaw);

    if (rules === undefined) {
      node.status({ fill: 'red', shape: 'ring', text: 'bad rules' });
      return;
    }

    const predicates = rules.map(makePredicate);
    const outputCount = predicates.length + 1; // +1 catch-all

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        let matched = false;
        const outputs: (NodeMessage | null)[] = new Array(outputCount).fill(null);
        for (let i = 0; i < predicates.length; i++) {
          if (predicates[i](msg)) {
            outputs[i] = msg;
            matched = true;
            break;
          }
        }
        if (!matched) {
          outputs[outputCount - 1] = msg;
        }
        node.send(outputs);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
};

export default filterNode;
