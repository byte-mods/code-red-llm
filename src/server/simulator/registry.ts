/**
 * Node-type simulator registry.
 *
 * Each registered simulator is a pure function that transforms a message
 * as if the real node had executed. Connectors return mock responses so
 * no external service is touched.
 *
 * The `function` simulator runs user JS inside `vm.runInNewContext` with
 * a 100 ms timeout. This matches Node-RED's own sandboxing strategy.
 */
import { runInNewContext } from 'node:vm';

import type { NodeMessage } from '../nodes/red-runtime.js';
import { cfgString } from '../nodes/helpers.js';
import type { NodeSimulator, SimulatorContext } from './types.js';

const registry = new Map<string, NodeSimulator>();

/** Default pass-through — used for unknown node types. */
const passThrough: NodeSimulator = (ctx) => ctx.msg;

registry.set('function', (ctx) => {
  const funcSrc = cfgString(ctx.config, 'func') ?? '';
  if (funcSrc.trim() === '') return ctx.msg;
  try {
    const code = `(function(msg) { ${funcSrc}\nreturn msg; })(msg)`;
    const result = runInNewContext(code, { msg: ctx.msg }, { timeout: 100 });
    if (result !== undefined && result !== null && typeof result === 'object') {
      return result as NodeMessage;
    }
    return ctx.msg;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    throw new Error(`sim-function: ${err}`);
  }
});

registry.set('debug', passThrough);
registry.set('inject', passThrough);
registry.set('catch', passThrough);

registry.set('http request', (ctx) => {
  const url = cfgString(ctx.config, 'url') ?? '';
  return {
    ...ctx.msg,
    payload: { statusCode: 200, statusText: 'OK', body: { mock: true, url }, headers: {} },
  };
});

registry.set('http in', (ctx) => {
  return { ...ctx.msg, payload: { mock: true, method: 'GET', url: '/' }, req: {}, res: {} };
});

registry.set('http response', passThrough);

// Database mocks — all return empty-success shapes.
const dbMock: NodeSimulator = (ctx) => {
  return { ...ctx.msg, payload: { rows: [], rowCount: 0, fields: [] } };
};
['postgres', 'mariadb', 'oraclesql', 'mongodb', 'cassandra', 'clickhouse', 'sqlite', 'influxdb', 'opensearch', 'elasticsearch', 'redis', 'etcd'].forEach((t) => registry.set(t, dbMock));

// Queue / stream mocks
registry.set('kafka-producer', (ctx) => ({ ...ctx.msg, payload: { sent: true, topic: cfgString(ctx.config, 'topic') ?? '' } }));
registry.set('kafka-consumer', (ctx) => ({ ...ctx.msg, payload: { message: { value: 'mock', topic: cfgString(ctx.config, 'topic') ?? '' }, partition: 0, offset: 0 } }));
registry.set('rabbitmq', (ctx) => ({ ...ctx.msg, payload: { sent: true, queue: cfgString(ctx.config, 'queue') ?? '' } }));
registry.set('nats', (ctx) => ({ ...ctx.msg, payload: { sent: true, subject: cfgString(ctx.config, 'subject') ?? '' } }));

// Storage mocks
registry.set('s3', (ctx) => ({ ...ctx.msg, payload: { ETag: '"mock"', Location: 's3://mock' } }));

// Search / vector mocks
registry.set('qdrant', (ctx) => ({ ...ctx.msg, payload: { result: [], status: 'ok' } }));
registry.set('weaviate', (ctx) => ({ ...ctx.msg, payload: { data: { Get: {} } } }));

// Graph mocks
registry.set('neo4j', (ctx) => ({ ...ctx.msg, payload: { records: [], summary: {} } }));
registry.set('graphql', (ctx) => ({ ...ctx.msg, payload: { data: {}, errors: [] } }));

// Utility mocks
registry.set('gate', passThrough);
registry.set('dedupe', passThrough);
registry.set('metronome', passThrough);
registry.set('scheduler', passThrough);
registry.set('pattern-match', passThrough);
registry.set('stream-join', passThrough);
registry.set('window-aggregate', passThrough);
registry.set('schema', passThrough);
registry.set('llm', (ctx) => ({ ...ctx.msg, payload: { content: 'mock llm response', model: cfgString(ctx.config, 'model') ?? '' } }));
registry.set('tracer', passThrough);
registry.set('query-table', passThrough);
registry.set('table-join', passThrough);
registry.set('liveview', passThrough);
registry.set('filter', passThrough);
registry.set('map', passThrough);
registry.set('feed-sim', (ctx) => {
  const schemaRaw = cfgString(ctx.config, 'schema') ?? '{}';
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(schemaRaw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') payload[k] = `mock-${v}`;
      }
    }
  } catch { /* ignore */ }
  return { ...ctx.msg, payload, topic: cfgString(ctx.config, 'topic') ?? '' };
});

export function getSimulator(nodeType: string): NodeSimulator {
  return registry.get(nodeType) ?? passThrough;
}

export function registerSimulator(nodeType: string, simulator: NodeSimulator): void {
  registry.set(nodeType, simulator);
}
