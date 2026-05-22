/**
 * Node-RED node: neo4j
 *
 * Graph database. Cypher query in, records out.
 *
 * Config:
 *   url       bolt:// or neo4j:// URL
 *   user, password
 *   database  default db name
 *   query     default Cypher
 *
 * Input msg:
 *   msg.query  Cypher string
 *   msg.params parameter object
 *
 * Output msg:
 *   msg.payload  array of record objects (key → value)
 */
import neo4j, { type Driver } from 'neo4j-driver';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'neo4j';

const neo4jNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const url = cfgString(config, 'url') ?? 'bolt://localhost:7687';
    const user = cfgString(config, 'user') ?? 'neo4j';
    const password = cfgString(config, 'password') ?? 'neo4j';
    const database = cfgString(config, 'database');
    const defaultQuery = cfgString(config, 'query');

    makeConnectorNode<Driver>(RED, config, {
      init: async () => neo4j.driver(url, neo4j.auth.basic(user, password)),
      handle: async (driver, msg: NodeMessage) => {
        const cypher =
          typeof msg['query'] === 'string' && msg['query'].trim() !== ''
            ? (msg['query'] as string)
            : defaultQuery;
        if (cypher === undefined) throw new Error('neo4j: no Cypher provided');
        const params = (msg['params'] as Record<string, unknown> | undefined) ?? {};
        const session = driver.session({ ...(database !== undefined ? { database } : {}) });
        try {
          const result = await session.run(cypher, params);
          return result.records.map((rec) => Object.fromEntries(rec.keys.map((k) => [k, rec.get(k)])));
        } finally {
          await session.close();
        }
      },
      dispose: async (driver) => {
        await driver.close();
      },
    })(this);
  });
};

export default neo4jNode;
