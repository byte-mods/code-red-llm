/**
 * Node-RED node: clickhouse
 *
 * Config:
 *   url       Full URL incl. scheme + host + port (http://localhost:8123)
 *   username, password
 *   database  default database
 *   query     default SQL
 *   operation query | insert
 *
 * Input msg:
 *   msg.query   SQL (query op)
 *   msg.table   target table (insert op)
 *   msg.values  array of rows (insert op)
 *
 * Output msg:
 *   msg.payload  JSON rows on query; ack object on insert
 *
 * Demo-grade. Uses the official @clickhouse/client over HTTP.
 */
import { createClient } from '@clickhouse/client';
import type { ClickHouseClient } from '@clickhouse/client';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'clickhouse';
type Operation = 'query' | 'insert';

const clickhouseNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const url = cfgString(config, 'url') ?? 'http://localhost:8123';
    const username = cfgString(config, 'username');
    const password = cfgString(config, 'password');
    const database = cfgString(config, 'database');
    const defaultQuery = cfgString(config, 'query');
    const operation = (cfgString(config, 'operation') ?? 'query') as Operation;

    makeConnectorNode<ClickHouseClient>(RED, config, {
      init: async () => {
        return createClient({
          url,
          ...(username !== undefined ? { username } : {}),
          ...(password !== undefined ? { password } : {}),
          ...(database !== undefined ? { database } : {}),
        });
      },
      handle: async (client, msg: NodeMessage) => {
        if (operation === 'query') {
          const sql =
            typeof msg['query'] === 'string' && msg['query'].trim() !== ''
              ? (msg['query'] as string)
              : defaultQuery;
          if (sql === undefined) throw new Error('clickhouse: no SQL provided');
          const resultSet = await client.query({ query: sql, format: 'JSONEachRow' });
          return await resultSet.json();
        }
        // insert
        const table = msg['table'] as string | undefined;
        const values = msg['values'];
        if (typeof table !== 'string' || !Array.isArray(values)) {
          throw new Error('clickhouse: insert requires msg.table (string) and msg.values (array)');
        }
        await client.insert({ table, values, format: 'JSONEachRow' });
        return { ok: true, inserted: values.length };
      },
      dispose: async (client) => {
        await client.close();
      },
    })(this);
  });
};

export default clickhouseNode;
