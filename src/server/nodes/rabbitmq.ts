/**
 * Node-RED node: rabbitmq (AMQP 0-9-1 via amqplib)
 *
 * Config:
 *   url        amqp://user:pw@host:5672/vhost
 *   exchange   default exchange
 *   queue      default queue
 *   operation  publish | consume
 *
 * Input msg (publish): msg.payload → message body
 * Emit msg (consume):   msg.payload = decoded body (string)
 *
 * The consumer is a source: it subscribes at deploy time and emits one
 * Node-RED message per AMQP delivery. ACKs are sent immediately on
 * delivery (auto-ack mode); production should ack after downstream work.
 */
import amqp from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';

import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'rabbitmq';
type Operation = 'publish' | 'consume';

interface Conn {
  conn: ChannelModel;
  ch: Channel;
}

const rabbitmqNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    const url = cfgString(config, 'url') ?? 'amqp://localhost';
    const exchange = cfgString(config, 'exchange') ?? '';
    const queue = cfgString(config, 'queue') ?? '';
    const operation = (cfgString(config, 'operation') ?? 'publish') as Operation;

    if (operation === 'consume') {
      // Source-node shape: subscribe at deploy, emit per message.
      RED.nodes.createNode(this, config);
      const node = this;
      let connRef: ChannelModel | undefined;
      let chRef: Channel | undefined;
      let stopped = false;

      void (async () => {
        try {
          node.status({ fill: 'yellow', shape: 'dot', text: 'connecting' });
          connRef = await amqp.connect(url);
          chRef = await connRef.createChannel();
          if (queue !== '') await chRef.assertQueue(queue);
          node.status({ fill: 'green', shape: 'dot', text: 'subscribed' });
          await chRef.consume(queue, (m) => {
            if (m === null || stopped) return;
            const out: NodeMessage = {
              payload: m.content.toString('utf-8'),
              fields: m.fields,
              properties: m.properties,
            };
            node.send(out);
          }, { noAck: true });
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 32) });
          node.error(err);
        }
      })();

      node.on('close', async (done) => {
        stopped = true;
        try { await chRef?.close(); } catch (e) { node.warn(String(e)); }
        try { await connRef?.close(); } catch (e) { node.warn(String(e)); }
        done();
      });
      return;
    }

    makeConnectorNode<Conn>(RED, config, {
      init: async () => {
        const conn = await amqp.connect(url);
        const ch = await conn.createChannel();
        if (exchange !== '') await ch.assertExchange(exchange, 'topic', { durable: true });
        return { conn, ch };
      },
      handle: async ({ ch }, msg: NodeMessage) => {
        const target = typeof msg['queue'] === 'string' ? (msg['queue'] as string) : queue;
        const ex = typeof msg['exchange'] === 'string' ? (msg['exchange'] as string) : exchange;
        const routingKey = typeof msg['routingKey'] === 'string' ? (msg['routingKey'] as string) : target;
        const body = msg['payload'];
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? null));
        if (ex !== '') {
          ch.publish(ex, routingKey, buf);
        } else {
          ch.sendToQueue(target, buf);
        }
        return { ok: true };
      },
      dispose: async ({ conn, ch }) => {
        await ch.close();
        await conn.close();
      },
    })(this);
  });
};

export default rabbitmqNode;
