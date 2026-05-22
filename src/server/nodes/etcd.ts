/**
 * Node-RED node: etcd (v3)
 *
 * Distributed KV / coordination store (Kubernetes' backing store).
 *
 * Config:
 *   hosts     comma-separated host:port list
 *   operation get | put | delete | watch
 *
 * Input msg:
 *   msg.key    target key
 *   msg.value  for put
 *
 * Output msg:
 *   msg.payload  value (get), ack (put/delete), event (watch)
 */
import { Etcd3 } from 'etcd3';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'etcd';
type Operation = 'get' | 'put' | 'delete';

const etcdNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const hostsRaw = cfgString(config, 'hosts') ?? 'localhost:2379';
    const operation = (cfgString(config, 'operation') ?? 'get') as Operation;
    const hosts = hostsRaw.split(',').map((s) => s.trim());

    makeConnectorNode<Etcd3>(RED, config, {
      init: async () => new Etcd3({ hosts }),
      handle: async (client, msg: NodeMessage) => {
        const key = typeof msg['key'] === 'string' ? (msg['key'] as string) : undefined;
        if (key === undefined) throw new Error('etcd: msg.key required');
        switch (operation) {
          case 'get':
            return await client.get(key).string();
          case 'put': {
            const value = msg['value'];
            if (value === undefined) throw new Error('etcd: put requires msg.value');
            await client.put(key).value(typeof value === 'string' ? value : JSON.stringify(value));
            return { ok: true, key };
          }
          case 'delete':
            await client.delete().key(key);
            return { ok: true, key };
          default:
            throw new Error(`etcd: unknown operation "${operation as string}"`);
        }
      },
      dispose: async (client) => {
        client.close();
      },
    })(this);
  });
};

export default etcdNode;
