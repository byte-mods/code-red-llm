/**
 * Node-RED node: oraclesql (Oracle Database via node-oracledb).
 *
 * Config:
 *   connectString   Easy Connect string (host:port/service)
 *   user, password
 *   query           Optional default SQL; msg.query overrides
 *
 * Input msg:
 *   msg.query   SQL string
 *   msg.params  Optional bind object or array
 *
 * Output msg:
 *   msg.payload = { rows, metaData }
 *
 * **Runtime requirement:** node-oracledb needs Oracle Instant Client
 * installed on the host. The npm module installs fine without it, but
 * the first connection will throw `NJS-045` / `DPI-1047`. See
 * https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html.
 * Demo-grade.
 */
import oracledb from 'oracledb';
import type { Pool } from 'oracledb';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'oraclesql';

const oraclesqlNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const connectString = cfgString(config, 'connectString');
    const user = cfgString(config, 'user');
    const password = cfgString(config, 'password');
    const defaultQuery = cfgString(config, 'query');

    makeConnectorNode<Pool>(RED, config, {
      init: async () => {
        if (connectString === undefined || user === undefined || password === undefined) {
          throw new Error('oraclesql: connectString, user, password are all required');
        }
        // Default to a small pool — Oracle is licensed per-session, so
        // pool sizing is a real cost concern. Override per workload.
        return oracledb.createPool({
          connectString,
          user,
          password,
          poolMin: 0,
          poolMax: 4,
        });
      },
      handle: async (pool, msg: NodeMessage) => {
        const sql =
          typeof msg['query'] === 'string' && msg['query'].trim() !== ''
            ? (msg['query'] as string)
            : defaultQuery;
        if (sql === undefined) {
          throw new Error('oraclesql: no SQL provided (msg.query or config.query)');
        }
        const params = msg['params'];
        const conn = await pool.getConnection();
        try {
          const result = await conn.execute(sql, params as never, { outFormat: oracledb.OUT_FORMAT_OBJECT });
          return { rows: result.rows, metaData: result.metaData };
        } finally {
          await conn.close();
        }
      },
      dispose: async (pool) => {
        await pool.close(10);
      },
    })(this);
  });
};

export default oraclesqlNode;
