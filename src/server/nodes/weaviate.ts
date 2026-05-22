/**
 * Node-RED node: weaviate (vector DB, v3 TS client)
 *
 * Config:
 *   host       hostname[:port]   (e.g. localhost:8080)
 *   scheme     http | https
 *   apiKey     optional API key
 *   className  default class
 *   operation  search | insert | delete
 *
 * Input msg:
 *   msg.vector   query vector (search) / insert vector
 *   msg.id       object id (insert/delete) — UUID required by Weaviate
 *   msg.props    object properties (insert)
 *   msg.limit    result count (search, default 10)
 */
import weaviate, { type WeaviateClient } from 'weaviate-client';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'weaviate';
type Operation = 'search' | 'insert' | 'delete';

const weaviateNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const host = cfgString(config, 'host') ?? 'localhost:8080';
    const apiKey = cfgString(config, 'apiKey');
    const defaultClassName = cfgString(config, 'className');
    const operation = (cfgString(config, 'operation') ?? 'search') as Operation;

    makeConnectorNode<WeaviateClient>(RED, config, {
      init: async () => {
        return weaviate.connectToCustom({
          httpHost: host.split(':')[0] ?? 'localhost',
          httpPort: Number(host.split(':')[1] ?? '8080'),
          grpcHost: host.split(':')[0] ?? 'localhost',
          grpcPort: 50051,
          ...(apiKey !== undefined ? { authCredentials: new weaviate.ApiKey(apiKey) } : {}),
        });
      },
      handle: async (client, msg: NodeMessage) => {
        const className = typeof msg['className'] === 'string' ? (msg['className'] as string) : defaultClassName;
        if (className === undefined) throw new Error('weaviate: className required');
        const coll = client.collections.use(className);
        switch (operation) {
          case 'search': {
            const vector = msg['vector'];
            if (!Array.isArray(vector)) throw new Error('weaviate: search requires msg.vector');
            const limit = typeof msg['limit'] === 'number' ? (msg['limit'] as number) : 10;
            return coll.query.nearVector(vector as number[], { limit });
          }
          case 'insert': {
            // Weaviate's strongly-typed `properties` field requires a
            // WeaviateField-shaped record; for a generic connector we
            // can't statically know the schema, so cast at the boundary.
            const props = (msg['props'] as Record<string, unknown> | undefined) ?? {};
            const vector = msg['vector'];
            const id = typeof msg['id'] === 'string' ? (msg['id'] as string) : undefined;
            // The driver's typing is per-collection — use a loose cast.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (coll.data as any).insert({
              ...(id !== undefined ? { id } : {}),
              properties: props,
              ...(Array.isArray(vector) ? { vectors: vector as number[] } : {}),
            });
          }
          case 'delete': {
            const id = msg['id'];
            if (typeof id !== 'string') throw new Error('weaviate: delete requires msg.id');
            return coll.data.deleteById(id);
          }
          default:
            throw new Error(`weaviate: unknown operation "${operation as string}"`);
        }
      },
      dispose: async (client) => {
        await client.close();
      },
    })(this);
  });
};

export default weaviateNode;
