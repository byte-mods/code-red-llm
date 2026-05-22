/**
 * Node-RED node: query-table
 *
 * In-memory query table with CRUD operations. Tables are shared by name
 * across all query-table nodes in the same Node-RED runtime.
 *
 * Config:
 *   tableName   — shared table identifier
 *   primaryKey  — field name used as the row key
 *   operation   — "read" | "write" | "delete"
 *
 * Input:
 *   msg.payload — for write: the record to insert/update
 *                 for read:  the key value to look up
 *                 for delete: the key value to remove
 *
 * Output:
 *   msg.payload — result record (read/write) or null (delete/missing)
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString } from './helpers.js';
import { getTable } from './table-registry.js';

const NODE_TYPE = 'query-table';

const queryTableNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const tableName = cfgString(config, 'tableName') ?? 'default';
    const primaryKey = cfgString(config, 'primaryKey') ?? 'id';
    const operation = cfgString(config, 'operation') ?? 'read';

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const table = getTable(tableName);
        const payload = (msg as Record<string, unknown>)['payload'];

        if (operation === 'write') {
          if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
            node.error(new Error('query-table write: payload must be an object'));
            done();
            return;
          }
          const record = payload as Record<string, unknown>;
          const key = String(record[primaryKey] ?? '');
          if (key === '') {
            node.error(new Error(`query-table write: record missing primaryKey "${primaryKey}"`));
            done();
            return;
          }
          table.set(key, record);
          node.send({ ...msg, payload: record });
        } else if (operation === 'read') {
          const key = String(payload ?? '');
          const record = table.get(key) ?? null;
          node.send({ ...msg, payload: record });
        } else if (operation === 'delete') {
          const key = String(payload ?? '');
          table.delete(key);
          node.send({ ...msg, payload: null });
        } else {
          node.error(new Error(`query-table: unknown operation "${operation}"`));
        }
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
};

export default queryTableNode;
