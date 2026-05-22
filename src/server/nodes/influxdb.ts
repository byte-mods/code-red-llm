/**
 * Node-RED node: influxdb (v2 / v3 cloud line protocol)
 *
 * Config:
 *   url         http://host:8086
 *   token       API token
 *   org         organisation
 *   bucket      target bucket
 *   operation   write | query
 *
 * Input msg (write):
 *   msg.measurement   measurement name
 *   msg.tags          { tag: value }
 *   msg.fields        { field: numericValue }
 *
 * Input msg (query):
 *   msg.query   Flux query
 *
 * Output msg:
 *   msg.payload  write op → { ok:true }; query op → array of records
 */
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import type { InfluxDB as InfluxDBType } from '@influxdata/influxdb-client';

import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'influxdb';
type Operation = 'write' | 'query';

const influxdbNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const url = cfgString(config, 'url') ?? 'http://localhost:8086';
    const token = cfgString(config, 'token') ?? '';
    const org = cfgString(config, 'org') ?? '';
    const bucket = cfgString(config, 'bucket') ?? '';
    const operation = (cfgString(config, 'operation') ?? 'write') as Operation;

    makeConnectorNode<InfluxDBType>(RED, config, {
      init: async () => new InfluxDB({ url, token }),
      handle: async (client, msg: NodeMessage) => {
        if (operation === 'write') {
          const measurement = typeof msg['measurement'] === 'string' ? (msg['measurement'] as string) : undefined;
          if (measurement === undefined) throw new Error('influxdb: msg.measurement required');
          const fields = (msg['fields'] as Record<string, number> | undefined) ?? {};
          const tags = (msg['tags'] as Record<string, string> | undefined) ?? {};
          const point = new Point(measurement);
          for (const [k, v] of Object.entries(tags)) point.tag(k, String(v));
          for (const [k, v] of Object.entries(fields)) point.floatField(k, Number(v));
          const w = client.getWriteApi(org, bucket);
          w.writePoint(point);
          await w.close();
          return { ok: true };
        }
        // query
        const flux = typeof msg['query'] === 'string' ? (msg['query'] as string) : undefined;
        if (flux === undefined) throw new Error('influxdb: msg.query required for query op');
        const q = client.getQueryApi(org);
        const rows: Record<string, unknown>[] = [];
        await new Promise<void>((resolve, reject) => {
          q.queryRows(flux, {
            next: (row: string[], meta: { toObject(r: string[]): Record<string, unknown> }) => {
              rows.push(meta.toObject(row));
            },
            error: reject,
            complete: resolve,
          });
        });
        return rows;
      },
      dispose: async () => {
        // Driver has no global close — write APIs are closed per-call above.
      },
    })(this);
  });
};

export default influxdbNode;
