/**
 * Node-RED node: table-join
 *
 * Enriches streaming messages by looking up a key in a shared query table.
 * This is the EventFlow "Table-Stream Join" concept retrofitted onto
 * Node-RED messages.
 *
 * Config:
 *   tableName   — shared table identifier (must match query-table nodes)
 *   keyField    — msg field to use as the lookup key (default "payload")
 *   outputField — msg field to write the result into (default "payload")
 *
 * Output:
 *   msg[outputField] = the matched record, or null if not found.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString } from './helpers.js';
import { getTable } from './table-registry.js';

const NODE_TYPE = 'table-join';

const tableJoinNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const tableName = cfgString(config, 'tableName') ?? 'default';
    const keyField = cfgString(config, 'keyField') ?? 'payload';
    const outputField = cfgString(config, 'outputField') ?? 'payload';

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const table = getTable(tableName);
        const m = msg as Record<string, unknown>;
        const keyValue = m[keyField];
        const key = String(keyValue ?? '');

        if (key === '') {
          node.send({ ...msg, [outputField]: null });
          done();
          return;
        }

        const record = table.get(key) ?? null;
        node.send({ ...msg, [outputField]: record });
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
};

export default tableJoinNode;
