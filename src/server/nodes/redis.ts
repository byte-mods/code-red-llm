/**
 * Node-RED node: redis
 *
 * Config:
 *   url      Connection URL (redis://[:pw]@host:port/db)
 *   command  default Redis command name (GET / SET / HGETALL / …)
 *
 * Input msg:
 *   msg.command  overrides default
 *   msg.args     array of command arguments
 *
 * Output msg:
 *   msg.payload  raw driver result for the command
 *
 * Demo-grade. Uses node-redis v4. Reconnect strategy is the driver default.
 */
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'redis';

const redisNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const url = cfgString(config, 'url') ?? 'redis://localhost:6379';
    const defaultCommand = cfgString(config, 'command') ?? 'GET';

    makeConnectorNode<RedisClientType>(RED, config, {
      init: async () => {
        const client: RedisClientType = createClient({ url });
        client.on('error', (e: unknown) => {
          // Surface but do not throw — the driver auto-reconnects.
          // eslint-disable-next-line no-console
          console.warn('redis client error', e);
        });
        await client.connect();
        return client;
      },
      handle: async (client, msg: NodeMessage) => {
        const cmd =
          typeof msg['command'] === 'string' && msg['command'].trim() !== ''
            ? (msg['command'] as string)
            : defaultCommand;
        const args = Array.isArray(msg['args']) ? (msg['args'] as Array<string | number>) : [];
        // node-redis v4 exposes sendCommand for arbitrary commands.
        const result = await client.sendCommand([cmd, ...args.map((a) => String(a))]);
        return result;
      },
      dispose: async (client) => {
        await client.quit();
      },
    })(this);
  });
};

export default redisNode;
