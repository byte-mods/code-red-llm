/**
 * Node-RED node: nats
 *
 * Modern lightweight messaging. One file covers publish + subscribe via
 * a config switch — same pattern as RabbitMQ.
 */
import { connect, StringCodec, type NatsConnection } from 'nats';

import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'nats';
type Operation = 'publish' | 'subscribe';

const natsNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    const servers = (cfgString(config, 'servers') ?? 'nats://localhost:4222')
      .split(',').map((s) => s.trim());
    const subject = cfgString(config, 'subject') ?? '';
    const operation = (cfgString(config, 'operation') ?? 'publish') as Operation;
    const sc = StringCodec();

    if (operation === 'subscribe') {
      RED.nodes.createNode(this, config);
      const node = this;
      let nc: NatsConnection | undefined;
      let stopped = false;

      void (async () => {
        try {
          node.status({ fill: 'yellow', shape: 'dot', text: 'connecting' });
          nc = await connect({ servers });
          const sub = nc.subscribe(subject);
          node.status({ fill: 'green', shape: 'dot', text: 'subscribed' });
          for await (const m of sub) {
            if (stopped) break;
            node.send({ payload: sc.decode(m.data), subject: m.subject });
          }
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 32) });
          node.error(err);
        }
      })();

      node.on('close', async (done) => {
        stopped = true;
        try { await nc?.drain(); } catch (e) { node.warn(String(e)); }
        done();
      });
      return;
    }

    makeConnectorNode<NatsConnection>(RED, config, {
      init: async () => connect({ servers }),
      handle: async (nc, msg: NodeMessage) => {
        const subj = typeof msg['subject'] === 'string' ? (msg['subject'] as string) : subject;
        if (subj === '') throw new Error('nats: subject is required');
        const body = msg['payload'];
        const data = typeof body === 'string' ? body : JSON.stringify(body ?? null);
        nc.publish(subj, sc.encode(data));
        return { ok: true, subject: subj };
      },
      dispose: async (nc) => {
        await nc.drain();
      },
    })(this);
  });
};

export default natsNode;
