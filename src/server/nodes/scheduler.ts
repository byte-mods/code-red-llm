/**
 * Node-RED node: scheduler
 *
 * Source node — fires a msg on a schedule. Two modes:
 *
 *   - interval  every N milliseconds
 *   - cron      cron expression (5- or 6-field, hand-parsed without a dep)
 *
 * Config:
 *   mode      'interval' | 'cron'
 *   intervalMs   for mode=interval
 *   cron      cron string for mode=cron — supported fields:
 *               minute hour dom month dow (5-field, classic cron)
 *               * / ranges / step / lists / wildcards
 *   payload   static payload to send each tick (string or JSON literal)
 *
 * Emits:
 *   msg.payload  configured payload (parsed JSON if it looked like JSON)
 *   msg.topic    timestamp ISO string of the firing
 *
 * Why hand-roll cron instead of `node-cron`: zero added deps, the parser
 * is ~40 lines, behaviour is fully observable. Drift past 1-minute
 * granularity is acceptable for a demo-grade scheduler.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString } from './helpers.js';

const NODE_TYPE = 'scheduler';

/**
 * Parse one cron field into a Set of integers representing every minute
 * within its range. Supports: '*', a literal, 'a-b', 'a-b/c', '*\/c', and
 * comma-separated lists of any of the above.
 */
function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    let step = 1;
    let body = part;
    if (part.includes('/')) {
      const [b, s] = part.split('/');
      body = b ?? '*';
      step = Number(s);
    }
    let lo = min;
    let hi = max;
    if (body !== '*') {
      if (body.includes('-')) {
        const [a, b] = body.split('-');
        lo = Number(a);
        hi = Number(b);
      } else {
        lo = hi = Number(body);
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`scheduler: cron must have 5 fields, got ${String(parts.length)}`);
  return {
    minute: parseField(parts[0] ?? '*', 0, 59),
    hour: parseField(parts[1] ?? '*', 0, 23),
    dom: parseField(parts[2] ?? '*', 1, 31),
    month: parseField(parts[3] ?? '*', 1, 12),
    dow: parseField(parts[4] ?? '*', 0, 6),
  };
}

function matches(c: ParsedCron, d: Date): boolean {
  return (
    c.minute.has(d.getMinutes()) &&
    c.hour.has(d.getHours()) &&
    c.dom.has(d.getDate()) &&
    c.month.has(d.getMonth() + 1) &&
    c.dow.has(d.getDay())
  );
}

function parsePayload(raw: string | undefined): unknown {
  if (raw === undefined || raw === '') return '';
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const schedulerNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const mode = (cfgString(config, 'mode') ?? 'interval') as 'interval' | 'cron';
    const intervalMs = cfgNumber(config, 'intervalMs') ?? 60_000;
    const cronStr = cfgString(config, 'cron') ?? '* * * * *';
    const payload = parsePayload(cfgString(config, 'payload'));

    let timer: NodeJS.Timeout | undefined;
    let cronTick: NodeJS.Timeout | undefined;

    function fire(): void {
      const out: NodeMessage = { payload, topic: new Date().toISOString() };
      node.send(out);
      node.status({ fill: 'green', shape: 'dot', text: `last fire ${new Date().toLocaleTimeString()}` });
    }

    if (mode === 'interval') {
      if (!Number.isFinite(intervalMs) || intervalMs < 50) {
        node.status({ fill: 'red', shape: 'ring', text: 'invalid interval' });
        node.error(new Error(`scheduler: intervalMs invalid (${String(intervalMs)})`));
        return;
      }
      timer = setInterval(fire, intervalMs);
      node.status({ fill: 'blue', shape: 'dot', text: `every ${String(intervalMs)}ms` });
    } else {
      let cron: ParsedCron;
      try {
        cron = parseCron(cronStr);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 32) });
        node.error(err);
        return;
      }
      // Tick once per minute and check. Drift up to ~60s acceptable.
      let lastFiredMinuteEpoch = -1;
      const tick = (): void => {
        const now = new Date();
        const minuteEpoch = Math.floor(now.getTime() / 60_000);
        if (minuteEpoch !== lastFiredMinuteEpoch && matches(cron, now)) {
          lastFiredMinuteEpoch = minuteEpoch;
          fire();
        }
      };
      cronTick = setInterval(tick, 15_000); // four-times-per-minute check
      tick();
      node.status({ fill: 'blue', shape: 'dot', text: `cron ${cronStr}` });
    }

    node.on('close', (done) => {
      if (timer !== undefined) clearInterval(timer);
      if (cronTick !== undefined) clearInterval(cronTick);
      done();
    });
  });
};

export default schedulerNode;
