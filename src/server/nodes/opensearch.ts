/**
 * Node-RED node: opensearch
 *
 * OpenSearch is the Amazon-backed fork of Elasticsearch. The client API
 * is intentionally close to @elastic/elasticsearch — we keep the same
 * operation set so flows can switch backends with minimal churn.
 */
import { Client } from '@opensearch-project/opensearch';
import type { Client as OsClient } from '@opensearch-project/opensearch';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'opensearch';
type Operation = 'search' | 'index' | 'get' | 'delete';

const opensearchNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const nodeUrl = cfgString(config, 'node') ?? 'http://localhost:9200';
    const username = cfgString(config, 'username');
    const password = cfgString(config, 'password');
    const defaultIndex = cfgString(config, 'index');
    const operation = (cfgString(config, 'operation') ?? 'search') as Operation;

    makeConnectorNode<OsClient>(RED, config, {
      init: async () => {
        return new Client({
          node: nodeUrl,
          ...(username !== undefined && password !== undefined
            ? { auth: { username, password } }
            : {}),
        });
      },
      handle: async (client, msg: NodeMessage) => {
        const index = (typeof msg['index'] === 'string' ? (msg['index'] as string) : defaultIndex);
        if (index === undefined) throw new Error('opensearch: index is required');
        switch (operation) {
          case 'search':
            return client.search({
              index,
              body: { query: (msg['query'] as object | undefined) ?? { match_all: {} } },
            });
          case 'index': {
            const doc = msg['doc'];
            if (doc === undefined) throw new Error('opensearch: index op requires msg.doc');
            const id = typeof msg['id'] === 'string' ? (msg['id'] as string) : undefined;
            return client.index({ index, ...(id !== undefined ? { id } : {}), body: doc as object });
          }
          case 'get': {
            const id = msg['id'];
            if (typeof id !== 'string') throw new Error('opensearch: get op requires msg.id');
            return client.get({ index, id });
          }
          case 'delete': {
            const id = msg['id'];
            if (typeof id !== 'string') throw new Error('opensearch: delete op requires msg.id');
            return client.delete({ index, id });
          }
          default:
            throw new Error(`opensearch: unknown operation "${operation as string}"`);
        }
      },
      dispose: async (client) => {
        await client.close();
      },
    })(this);
  });
};

export default opensearchNode;
