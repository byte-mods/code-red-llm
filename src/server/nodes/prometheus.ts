/**
 * Node-RED node: prometheus (Pushgateway)
 *
 * Pushes a single metric line to a Prometheus Pushgateway. Suitable for
 * batch jobs / one-shot events. For long-running scrape targets, expose
 * an HTTP endpoint with a metrics library instead — that's a different
 * shape than a Node-RED connector.
 *
 * Config:
 *   url       Pushgateway URL (http://localhost:9091)
 *   job       job label (required by Pushgateway)
 *   instance  optional instance label
 *   metric    default metric name
 *
 * Input msg:
 *   msg.metric  override default
 *   msg.value   numeric value (required)
 *   msg.labels  { label: value }
 *
 * Output msg:
 *   msg.payload  { ok: true, status: 200 }
 */
import type { NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString, makeConnectorNode } from './helpers.js';

const NODE_TYPE = 'prometheus';

const prometheusNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this, config) {
    const url = cfgString(config, 'url') ?? 'http://localhost:9091';
    const job = cfgString(config, 'job') ?? 'no_code_red';
    const instance = cfgString(config, 'instance');
    const defaultMetric = cfgString(config, 'metric');

    makeConnectorNode<string>(RED, config, {
      init: async () => url, // no driver — the "client" is just the base URL string
      handle: async (base, msg: NodeMessage) => {
        const metric = typeof msg['metric'] === 'string' ? (msg['metric'] as string) : defaultMetric;
        if (metric === undefined) throw new Error('prometheus: metric name required');
        const value = msg['value'];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error('prometheus: msg.value must be a finite number');
        }
        const labels = (msg['labels'] as Record<string, string> | undefined) ?? {};
        const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${String(v)}"`).join(',');
        const body = labelStr === ''
          ? `${metric} ${value}\n`
          : `${metric}{${labelStr}} ${value}\n`;
        const path = `/metrics/job/${encodeURIComponent(job)}${instance !== undefined ? `/instance/${encodeURIComponent(instance)}` : ''}`;
        const res = await fetch(base + path, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; version=0.0.4' },
          body,
        });
        if (!res.ok) throw new Error(`prometheus: push failed ${String(res.status)} ${res.statusText}`);
        return { ok: true, status: res.status };
      },
      dispose: async () => {},
    })(this);
  });
};

export default prometheusNode;
