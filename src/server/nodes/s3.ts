/**
 * Node-RED node: s3 (works with AWS S3 and MinIO via endpoint override)
 *
 * Config:
 *   endpoint        optional — leave blank for AWS, set for MinIO (http://localhost:9000)
 *   region          AWS region or any string for MinIO
 *   accessKeyId, secretAccessKey
 *   bucket          default bucket
 *   operation       getObject | putObject | deleteObject | listObjects
 */
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 's3';
type Operation = 'getObject' | 'putObject' | 'deleteObject' | 'listObjects';

async function streamToString(stream: unknown): Promise<string> {
  const s = stream as { transformToString?: () => Promise<string> };
  if (typeof s.transformToString === 'function') return s.transformToString();
  return '';
}

const s3Node: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const endpoint = cfgString(config, 'endpoint');
    const region = cfgString(config, 'region') ?? 'us-east-1';
    const accessKeyId = cfgString(config, 'accessKeyId');
    const secretAccessKey = cfgString(config, 'secretAccessKey');
    const defaultBucket = cfgString(config, 'bucket');
    const operation = (cfgString(config, 'operation') ?? 'getObject') as Operation;

    makeConnectorNode<S3Client>(RED, config, {
      init: async () => new S3Client({
        region,
        ...(endpoint !== undefined ? { endpoint, forcePathStyle: true } : {}),
        ...(accessKeyId !== undefined && secretAccessKey !== undefined
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      }),
      handle: async (client, msg: NodeMessage) => {
        const Bucket = typeof msg['bucket'] === 'string' ? (msg['bucket'] as string) : defaultBucket;
        if (Bucket === undefined) throw new Error('s3: bucket required');
        const Key = typeof msg['key'] === 'string' ? (msg['key'] as string) : undefined;
        switch (operation) {
          case 'getObject': {
            if (Key === undefined) throw new Error('s3: msg.key required');
            const r = await client.send(new GetObjectCommand({ Bucket, Key }));
            return { body: await streamToString(r.Body), contentType: r.ContentType };
          }
          case 'putObject': {
            if (Key === undefined) throw new Error('s3: msg.key required');
            const body = msg['payload'];
            const Body = typeof body === 'string' || Buffer.isBuffer(body)
              ? (body as string | Buffer)
              : JSON.stringify(body ?? null);
            return client.send(new PutObjectCommand({ Bucket, Key, Body }));
          }
          case 'deleteObject': {
            if (Key === undefined) throw new Error('s3: msg.key required');
            return client.send(new DeleteObjectCommand({ Bucket, Key }));
          }
          case 'listObjects': {
            const Prefix = typeof msg['prefix'] === 'string' ? (msg['prefix'] as string) : undefined;
            return client.send(new ListObjectsV2Command({ Bucket, ...(Prefix !== undefined ? { Prefix } : {}) }));
          }
          default:
            throw new Error(`s3: unknown operation "${operation as string}"`);
        }
      },
      dispose: async (client) => {
        client.destroy();
      },
    })(this);
  });
};

export default s3Node;
