/**
 * Node-RED node: sqlite (better-sqlite3)
 *
 * Embedded SQL. Useful for local persistence, edge devices, and
 * lightweight aggregation without a separate server.
 *
 * Config:
 *   file   path to the .sqlite file (created on first write if absent)
 *   query  optional default SQL
 *
 * Input msg:
 *   msg.query   SQL string
 *   msg.params  array OR object of bind parameters
 *
 * Output msg:
 *   msg.payload  rows (for SELECT) or { changes, lastInsertRowid }
 */
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'sqlite';

const sqliteNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const file = cfgString(config, 'file') ?? ':memory:';
    const defaultQuery = cfgString(config, 'query');

    makeConnectorNode<DB>(RED, config, {
      init: async () => new Database(file),
      handle: async (db, msg: NodeMessage) => {
        const sql =
          typeof msg['query'] === 'string' && msg['query'].trim() !== ''
            ? (msg['query'] as string)
            : defaultQuery;
        if (sql === undefined) throw new Error('sqlite: no SQL provided');
        const stmt = db.prepare(sql);
        const params = msg['params'];
        // better-sqlite3 separates read and write paths. SELECT must use
        // `all`/`get`; INSERT/UPDATE/DELETE must use `run`. We check the
        // first significant token to pick the right one.
        const first = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
        if (first === 'SELECT' || first === 'WITH' || first === 'PRAGMA') {
          return Array.isArray(params) ? stmt.all(...params) : stmt.all((params ?? {}) as never);
        }
        const result = Array.isArray(params)
          ? stmt.run(...params)
          : stmt.run((params ?? {}) as never);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      },
      dispose: async (db) => {
        db.close();
      },
    })(this);
  });
};

export default sqliteNode;
