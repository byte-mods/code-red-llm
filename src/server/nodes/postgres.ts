/**
 * Node-RED node: postgres
 *
 * Config:
 *   connectionString  Postgres URL (postgres://user:pw@host:port/db)
 *   query             Optional default SQL; msg.query overrides
 *
 * Input msg:
 *   msg.query  SQL string (overrides config.query when present)
 *   msg.params Optional array of parameters bound to $1, $2, …
 *
 * Output msg:
 *   msg.payload = { rows, rowCount, fields }
 *
 * Demo-grade: uses a single Pool with lazy connect. Production should add
 * statement timeouts, retry/backoff, structured query logging, and pool-
 * size tuning per workload.
 */
import { Pool } from 'pg';
import type { Pool as PoolType, QueryResult } from 'pg';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'postgres';

const postgresNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const connectionString = cfgString(config, 'connectionString');
    const defaultQuery = cfgString(config, 'query');

    makeConnectorNode<PoolType>(RED, config, {
      init: async () => {
        if (connectionString === undefined) {
          throw new Error('postgres: connectionString is required');
        }
        return new Pool({ connectionString });
      },
      handle: async (pool, msg: NodeMessage) => {
        const sql =
          typeof msg['query'] === 'string' && msg['query'].trim() !== ''
            ? (msg['query'] as string)
            : defaultQuery;
        if (sql === undefined) {
          throw new Error('postgres: no SQL provided (msg.query or config.query)');
        }
        const params = Array.isArray(msg['params']) ? (msg['params'] as unknown[]) : [];
        const result: QueryResult = await pool.query(sql, params);
        return {
          rows: result.rows,
          rowCount: result.rowCount,
          fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        };
      },
      dispose: async (pool) => {
        await pool.end();
      },
    })(this);
  });
};

export default postgresNode;
