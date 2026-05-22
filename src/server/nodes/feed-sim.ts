/**
 * Node-RED node: feed-sim
 *
 * Generates synthetic event streams for testing. Matches the TIBCO
 * StreamBase "Feed Simulation" concept — produce realistic-looking
 * tuples without an external data source.
 *
 * Config:
 *   schema    — JSON object mapping field names to type tags
 *   interval  — ms between events (default 1000)
 *   count     — max events to emit, 0 = infinite (default 0)
 *   topic     — msg.topic value (default "")
 *
 * Output:
 *   msg.payload — object with synthetic fields matching the schema
 *   msg.topic   — the configured topic string
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, cfgNumber } from './helpers.js';

const NODE_TYPE = 'feed-sim';

function randString(): string {
  return Math.random().toString(36).slice(2, 8);
}

function randNumber(): number {
  return Math.random() * 100;
}

function randInteger(): number {
  return Math.floor(Math.random() * 100);
}

function randBoolean(): boolean {
  return Math.random() < 0.5;
}

function generateValue(type: string): unknown {
  switch (type) {
    case 'string': return randString();
    case 'number': return randNumber();
    case 'integer': return randInteger();
    case 'boolean': return randBoolean();
    case 'object': return {};
    case 'array': return [];
    case 'null': return null;
    default: return null;
  }
}

function parseSchema(raw: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') return undefined;
      out[k] = v;
    }
    return out;
  } catch {
    return undefined;
  }
}

const feedSimNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const schemaRaw = cfgString(config, 'schema') ?? '{}';
    const intervalMs = cfgNumber(config, 'interval') ?? 1000;
    const maxCount = cfgNumber(config, 'count') ?? 0;
    const topic = cfgString(config, 'topic') ?? '';

    const schema = parseSchema(schemaRaw);
    if (schema === undefined) {
      node.status({ fill: 'red', shape: 'ring', text: 'bad schema' });
      return;
    }

    let emitted = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    function tick() {
      if (maxCount > 0 && emitted >= maxCount) {
        if (timer) clearInterval(timer);
        timer = null;
        return;
      }
      if (schema === undefined) return;
      const payload: Record<string, unknown> = {};
      for (const [field, type] of Object.entries(schema)) {
        payload[field] = generateValue(type);
      }
      node.send({ payload, topic });
      emitted += 1;
    }

    timer = setInterval(tick, intervalMs);
    node.status({ fill: 'green', shape: 'dot', text: `0 / ${maxCount > 0 ? String(maxCount) : '∞'}` });

    node.on('close', (done) => {
      if (timer) clearInterval(timer);
      timer = null;
      done();
    });
  });
};

export default feedSimNode;
