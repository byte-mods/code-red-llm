/**
 * Node-RED node: kafka-consumer
 *
 * Unlike the other connectors, this one is a *source* — it does not wait
 * for an input message. It subscribes at node creation and emits one
 * Node-RED message per Kafka record.
 *
 * Config:
 *   brokers    comma-separated host:port list
 *   clientId   consumer client id
 *   groupId    consumer group id (required by Kafka)
 *   topic      topic to subscribe to
 *   fromBeginning  bool — replay from earliest offset (default false)
 *
 * Emits msg:
 *   msg.topic    topic the record came from
 *   msg.partition partition number
 *   msg.offset   record offset (string)
 *   msg.key      record key as string (or undefined)
 *   msg.payload  record value as string (UTF-8 decoded; raw Buffer also in msg.value)
 *
 * Demo-grade. Auto-commit per the driver default; production should
 * commit explicitly after downstream processing succeeds.
 */
import { Kafka, type Consumer } from 'kafkajs';

import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgBoolean, cfgString } from './helpers.js';

const NODE_TYPE = 'kafka-consumer';

const kafkaConsumerNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const brokersRaw = cfgString(config, 'brokers') ?? 'localhost:9092';
    const clientId = cfgString(config, 'clientId') ?? 'no-code-red-consumer';
    const groupId = cfgString(config, 'groupId');
    const topic = cfgString(config, 'topic');
    const fromBeginning = cfgBoolean(config, 'fromBeginning');

    if (groupId === undefined || topic === undefined) {
      node.status({ fill: 'red', shape: 'ring', text: 'groupId and topic required' });
      node.error(new Error('kafka-consumer: groupId and topic are required'));
      return;
    }

    const brokers = brokersRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const kafka = new Kafka({ brokers, clientId });
    const consumer: Consumer = kafka.consumer({ groupId });

    let stopped = false;

    void (async () => {
      try {
        node.status({ fill: 'yellow', shape: 'dot', text: 'connecting' });
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning });
        node.status({ fill: 'green', shape: 'dot', text: 'subscribed' });
        await consumer.run({
          eachMessage: async ({ topic: t, partition, message }) => {
            if (stopped) return;
            const out: NodeMessage = {
              topic: t,
              partition,
              offset: message.offset,
              key: message.key !== null ? message.key.toString('utf-8') : undefined,
              value: message.value,
              payload: message.value !== null ? message.value.toString('utf-8') : null,
            };
            node.send(out);
          },
        });
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 32) });
        node.error(err);
      }
    })();

    node.on('close', async (done) => {
      stopped = true;
      try {
        await consumer.disconnect();
      } catch (e) {
        node.warn(e instanceof Error ? e.message : String(e));
      }
      done();
    });
  });
};

export default kafkaConsumerNode;
