/**
 * Node-RED node: cassandra (and scylladb, which is wire-compatible).
 *
 * One implementation file backs both NODE_TYPE values — Scylla speaks the
 * Cassandra Query Language (CQL) over the same protocol, so the
 * cassandra-driver client works against both.
 *
 * Config:
 *   contactPoints   comma-separated host list
 *   localDataCenter logical DC name (driver requires this)
 *   keyspace        default keyspace
 *   query           default CQL
 *
 * Input msg:
 *   msg.query   CQL string
 *   msg.params  array of bound parameters
 *
 * Output msg:
 *   msg.payload = { rows, rowLength }
 *
 * Demo-grade. No SSL config; add `sslOptions` for production clusters.
 */
import { Client } from 'cassandra-driver';
import type { Client as CassandraClient } from 'cassandra-driver';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

function makeNode(nodeType: 'cassandra' | 'scylladb'): NodeModule {
  return (RED) => {
    RED.nodes.registerType(nodeType, function (this, config) {
      const contactPointsRaw = cfgString(config, 'contactPoints') ?? 'localhost';
      const localDataCenter = cfgString(config, 'localDataCenter') ?? 'datacenter1';
      const keyspace = cfgString(config, 'keyspace');
      const defaultQuery = cfgString(config, 'query');

      const contactPoints = contactPointsRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');

      makeConnectorNode<CassandraClient>(RED, config, {
        init: async () => {
          const client = new Client({
            contactPoints,
            localDataCenter,
            ...(keyspace !== undefined ? { keyspace } : {}),
          });
          await client.connect();
          return client;
        },
        handle: async (client, msg: NodeMessage) => {
          const sql =
            typeof msg['query'] === 'string' && msg['query'].trim() !== ''
              ? (msg['query'] as string)
              : defaultQuery;
          if (sql === undefined) {
            throw new Error(`${nodeType}: no CQL provided (msg.query or config.query)`);
          }
          const params = Array.isArray(msg['params']) ? (msg['params'] as unknown[]) : [];
          const result = await client.execute(sql, params, { prepare: true });
          return { rows: result.rows, rowLength: result.rowLength };
        },
        dispose: async (client) => {
          await client.shutdown();
        },
      })(this);
    });
  };
}

export const cassandraNode = makeNode('cassandra');
export const scylladbNode = makeNode('scylladb');
export default cassandraNode;
