/**
 * Node-RED node: graphql (generic client)
 *
 * Config:
 *   endpoint     GraphQL URL
 *   authHeader   optional — full Authorization header value
 *   query        default query string
 *
 * Input msg:
 *   msg.query      overrides config query
 *   msg.variables  variables object
 *
 * Output msg:
 *   msg.payload    data field from the response
 */
import { GraphQLClient } from 'graphql-request';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'graphql';

const graphqlNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const endpoint = cfgString(config, 'endpoint') ?? 'http://localhost:4000/graphql';
    const authHeader = cfgString(config, 'authHeader');
    const defaultQuery = cfgString(config, 'query');

    makeConnectorNode<GraphQLClient>(RED, config, {
      init: async () => new GraphQLClient(endpoint, {
        ...(authHeader !== undefined ? { headers: { Authorization: authHeader } } : {}),
      }),
      handle: async (client, msg: NodeMessage) => {
        const query =
          typeof msg['query'] === 'string' && msg['query'].trim() !== ''
            ? (msg['query'] as string)
            : defaultQuery;
        if (query === undefined) throw new Error('graphql: no query provided');
        const variables = (msg['variables'] as Record<string, unknown> | undefined) ?? {};
        return client.request(query, variables);
      },
      dispose: async () => {
        // GraphQLClient is stateless w.r.t. background resources.
      },
    })(this);
  });
};

export default graphqlNode;
