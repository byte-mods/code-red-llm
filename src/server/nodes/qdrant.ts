/**
 * Node-RED node: qdrant (vector DB)
 *
 * Config:
 *   url        http(s) URL (https://localhost:6333)
 *   apiKey     optional API key
 *   collection default collection
 *   operation  search | upsert | delete
 *
 * Input msg:
 *   msg.vector     query vector (search) or upsert point vector
 *   msg.id         point id (upsert/delete)
 *   msg.payload    point payload (upsert) — note: clashes with output naming;
 *                   prefer msg.point.payload to disambiguate
 *   msg.point      { id, vector, payload } shorthand for upsert
 *   msg.limit      result count (search, default 10)
 */
import { QdrantClient } from '@qdrant/js-client-rest';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'qdrant';
type Operation = 'search' | 'upsert' | 'delete';

const qdrantNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const url = cfgString(config, 'url') ?? 'http://localhost:6333';
    const apiKey = cfgString(config, 'apiKey');
    const defaultCollection = cfgString(config, 'collection');
    const operation = (cfgString(config, 'operation') ?? 'search') as Operation;

    makeConnectorNode<QdrantClient>(RED, config, {
      init: async () => new QdrantClient({ url, ...(apiKey !== undefined ? { apiKey } : {}) }),
      handle: async (client, msg: NodeMessage) => {
        const collection = typeof msg['collection'] === 'string' ? (msg['collection'] as string) : defaultCollection;
        if (collection === undefined) throw new Error('qdrant: collection required');
        switch (operation) {
          case 'search': {
            const vector = msg['vector'];
            if (!Array.isArray(vector)) throw new Error('qdrant: search requires msg.vector (number[])');
            const limit = typeof msg['limit'] === 'number' ? (msg['limit'] as number) : 10;
            return client.search(collection, { vector: vector as number[], limit });
          }
          case 'upsert': {
            const point = (msg['point'] as { id: string | number; vector: number[]; payload?: Record<string, unknown> } | undefined);
            if (point === undefined) throw new Error('qdrant: upsert requires msg.point');
            return client.upsert(collection, { points: [point] });
          }
          case 'delete': {
            const id = msg['id'];
            if (typeof id !== 'string' && typeof id !== 'number') throw new Error('qdrant: delete requires msg.id');
            return client.delete(collection, { points: [id as string | number] });
          }
          default:
            throw new Error(`qdrant: unknown operation "${operation as string}"`);
        }
      },
      dispose: async () => {
        // QdrantClient has no explicit close — it's a thin HTTP wrapper.
      },
    })(this);
  });
};

export default qdrantNode;
