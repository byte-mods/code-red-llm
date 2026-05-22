/**
 * Node-RED node: kafka-producer
 *
 * Config:
 *   brokers    comma-separated host:port list
 *   clientId   producer client id
 *   topic      default topic; msg.topic overrides
 *
 * Input msg:
 *   msg.topic   target topic
 *   msg.key     optional key (string)
 *   msg.payload value to send — stringified if not a string/Buffer
 *
 * Output msg:
 *   msg.payload  driver send-result (partition, offset)
 *
 * Demo-grade. SASL/SSL not wired — production deployments need them.
 */
import { Kafka } from 'kafkajs';
import type { Producer } from 'kafkajs';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'kafka-producer';

function toBuffer(v: unknown): Buffer | string {
  if (typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return v;
  return JSON.stringify(v ?? null);
}

const kafkaProducerNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const brokersRaw = cfgString(config, 'brokers') ?? 'localhost:9092';
    const clientId = cfgString(config, 'clientId') ?? 'no-code-red-producer';
    const defaultTopic = cfgString(config, 'topic');
    const brokers = brokersRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');

    makeConnectorNode<Producer>(RED, config, {
      init: async () => {
        const kafka = new Kafka({ brokers, clientId });
        const producer = kafka.producer();
        await producer.connect();
        return producer;
      },
      handle: async (producer, msg: NodeMessage) => {
        const topic =
          typeof msg['topic'] === 'string' && msg['topic'].trim() !== ''
            ? (msg['topic'] as string)
            : defaultTopic;
        if (topic === undefined) throw new Error('kafka-producer: topic is required');
        const value = toBuffer(msg['payload']);
        const key = typeof msg['key'] === 'string' ? (msg['key'] as string) : undefined;
        const sent = await producer.send({
          topic,
          messages: [{ ...(key !== undefined ? { key } : {}), value }],
        });
        return sent;
      },
      dispose: async (producer) => {
        await producer.disconnect();
      },
    })(this);
  });
};

export default kafkaProducerNode;
