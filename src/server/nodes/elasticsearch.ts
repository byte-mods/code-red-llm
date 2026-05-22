/**
 * Node-RED node: elasticsearch
 *
 * Config:
 *   node      cluster URL (https://es.local:9200)
 *   username, password (basic auth)
 *   index     default index name
 *   operation search | index | get | delete
 *
 * Input msg:
 *   msg.index  override index
 *   msg.id     document id (get/delete/index-with-id)
 *   msg.doc    document body (index)
 *   msg.query  query DSL (search)
 *
 * Output msg:
 *   msg.payload  driver response body
 */
import { Client } from '@elastic/elasticsearch';
import type { Client as EsClient } from '@elastic/elasticsearch';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'elasticsearch';
type Operation = 'search' | 'index' | 'get' | 'delete';

const elasticsearchNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const node = cfgString(config, 'node') ?? 'http://localhost:9200';
    const username = cfgString(config, 'username');
    const password = cfgString(config, 'password');
    const defaultIndex = cfgString(config, 'index');
    const operation = (cfgString(config, 'operation') ?? 'search') as Operation;

    makeConnectorNode<EsClient>(RED, config, {
      init: async () => {
        return new Client({
          node,
          ...(username !== undefined && password !== undefined
            ? { auth: { username, password } }
            : {}),
        });
      },
      handle: async (client, msg: NodeMessage) => {
        const index = (typeof msg['index'] === 'string' ? (msg['index'] as string) : defaultIndex);
        if (index === undefined) throw new Error('elasticsearch: index is required');
        switch (operation) {
          case 'search':
            return client.search({ index, query: (msg['query'] as object | undefined) ?? { match_all: {} } });
          case 'index': {
            const doc = msg['doc'];
            if (doc === undefined) throw new Error('elasticsearch: index op requires msg.doc');
            const id = typeof msg['id'] === 'string' ? (msg['id'] as string) : undefined;
            return client.index({ index, ...(id !== undefined ? { id } : {}), document: doc as object });
          }
          case 'get': {
            const id = msg['id'];
            if (typeof id !== 'string') throw new Error('elasticsearch: get op requires msg.id');
            return client.get({ index, id });
          }
          case 'delete': {
            const id = msg['id'];
            if (typeof id !== 'string') throw new Error('elasticsearch: delete op requires msg.id');
            return client.delete({ index, id });
          }
          default:
            throw new Error(`elasticsearch: unknown operation "${operation as string}"`);
        }
      },
      dispose: async (client) => {
        await client.close();
      },
    })(this);
  });
};

export default elasticsearchNode;
