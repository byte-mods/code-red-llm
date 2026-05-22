/**
 * Node-RED node: mariadb (works for MySQL too — the driver is wire-compat).
 *
 * Config:
 *   host, port, user, password, database
 *   query  Optional default SQL; msg.query overrides
 *
 * Input msg:
 *   msg.query   SQL string (overrides config.query)
 *   msg.params  Optional array of bound parameters
 *
 * Output msg:
 *   msg.payload = { rows, affectedRows?, insertId? }
 *
 * Demo-grade. Pool is created with the driver's default settings.
 */
import * as mariadb from 'mariadb';
import type { Pool, PoolConnection } from 'mariadb';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'mariadb';

const mariadbNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const host = cfgString(config, 'host') ?? 'localhost';
    const port = cfgNumber(config, 'port') ?? 3306;
    const user = cfgString(config, 'user');
    const password = cfgString(config, 'password');
    const database = cfgString(config, 'database');
    const defaultQuery = cfgString(config, 'query');

    makeConnectorNode<Pool>(RED, config, {
      init: async () => {
        return mariadb.createPool({
          host,
          port,
          ...(user !== undefined ? { user } : {}),
          ...(password !== undefined ? { password } : {}),
          ...(database !== undefined ? { database } : {}),
          connectionLimit: 5,
        });
      },
      handle: async (pool, msg: NodeMessage) => {
        const sql =
          typeof msg['query'] === 'string' && msg['query'].trim() !== ''
            ? (msg['query'] as string)
            : defaultQuery;
        if (sql === undefined) {
          throw new Error('mariadb: no SQL provided (msg.query or config.query)');
        }
        const params = Array.isArray(msg['params']) ? (msg['params'] as unknown[]) : undefined;
        const conn: PoolConnection = await pool.getConnection();
        try {
          const result = await conn.query(sql, params);
          return result;
        } finally {
          conn.release();
        }
      },
      dispose: async (pool) => {
        await pool.end();
      },
    })(this);
  });
};

export default mariadbNode;
