/**
 * Node-RED node: mongodb
 *
 * Config:
 *   uri        mongodb://… connection string
 *   database   default database name
 *   collection default collection name
 *   operation  find | insertOne | updateOne | deleteOne | aggregate
 *
 * Input msg:
 *   msg.filter     query filter (find / update / delete)
 *   msg.doc        document (insertOne)
 *   msg.update     update spec (updateOne, e.g. { $set: { x: 1 } })
 *   msg.pipeline   aggregation pipeline (aggregate)
 *   msg.collection override collection
 *
 * Output msg:
 *   msg.payload  driver result (array for find/aggregate, ack object otherwise)
 *
 * Demo-grade. Single MongoClient with default pool settings.
 */
import { MongoClient } from 'mongodb';
import type { Document } from 'mongodb';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'mongodb';
type Operation = 'find' | 'insertOne' | 'updateOne' | 'deleteOne' | 'aggregate';

const mongodbNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const uri = cfgString(config, 'uri') ?? 'mongodb://localhost:27017';
    const defaultDb = cfgString(config, 'database');
    const defaultCol = cfgString(config, 'collection');
    const operation = (cfgString(config, 'operation') ?? 'find') as Operation;

    makeConnectorNode<MongoClient>(RED, config, {
      init: async () => {
        const client = new MongoClient(uri);
        await client.connect();
        return client;
      },
      handle: async (client, msg: NodeMessage) => {
        const dbName =
          typeof msg['database'] === 'string' ? (msg['database'] as string) : defaultDb;
        const colName =
          typeof msg['collection'] === 'string' ? (msg['collection'] as string) : defaultCol;
        if (dbName === undefined || colName === undefined) {
          throw new Error('mongodb: database and collection are required');
        }
        const col = client.db(dbName).collection(colName);
        const filter = (msg['filter'] as Document | undefined) ?? {};
        switch (operation) {
          case 'find':
            return col.find(filter).toArray();
          case 'insertOne': {
            const doc = msg['doc'] as Document | undefined;
            if (doc === undefined) throw new Error('mongodb: insertOne requires msg.doc');
            return col.insertOne(doc);
          }
          case 'updateOne': {
            const update = msg['update'] as Document | undefined;
            if (update === undefined) throw new Error('mongodb: updateOne requires msg.update');
            return col.updateOne(filter, update);
          }
          case 'deleteOne':
            return col.deleteOne(filter);
          case 'aggregate': {
            const pipeline = Array.isArray(msg['pipeline'])
              ? (msg['pipeline'] as Document[])
              : [];
            return col.aggregate(pipeline).toArray();
          }
          default:
            throw new Error(`mongodb: unknown operation "${operation}"`);
        }
      },
      dispose: async (client) => {
        await client.close();
      },
    })(this);
  });
};

export default mongodbNode;
