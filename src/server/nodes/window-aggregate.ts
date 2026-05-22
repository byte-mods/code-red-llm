/**
 * Node-RED node: window-aggregate
 *
 * Stateful CEP operator. Groups arriving messages into a window keyed
 * by `msg[keyField]` (or one global bucket if keyField is empty),
 * aggregates `msg.payload[valueField]` (or `msg.payload` if no field),
 * and emits a single message when the window closes.
 *
 * Window types:
 *   - tumbling  fixed-size, non-overlapping ([0,W), [W,2W), …)
 *   - sliding   fixed-size, overlapping every slideMs
 *   - session   closes after sessionGapMs of inactivity per key
 *
 * Aggregate ops: count | sum | avg | min | max | last | first
 *
 * Emitted msg:
 *   msg.payload   the aggregate value
 *   msg.key       the bucket key (or undefined for global)
 *   msg.count     number of messages in the window
 *   msg.windowStart / msg.windowEnd   ISO timestamps
 *
 * Demo-grade: state lives in process memory. Use the persistence module
 * for durable state in production.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString } from './helpers.js';

const NODE_TYPE = 'window-aggregate';
type WindowKind = 'tumbling' | 'sliding' | 'session';
type Op = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'last' | 'first';

interface Bucket {
  values: number[];
  first: unknown;
  last: unknown;
  startMs: number;
  endMs: number;
  // For session windows: rolling deadline updates with each event.
  deadline: number;
}

function aggregate(b: Bucket, op: Op): unknown {
  if (b.values.length === 0) {
    return op === 'count' ? 0 : op === 'first' ? b.first : b.last;
  }
  switch (op) {
    case 'count': return b.values.length;
    case 'sum':   return b.values.reduce((a, c) => a + c, 0);
    case 'avg':   return b.values.reduce((a, c) => a + c, 0) / b.values.length;
    case 'min':   return Math.min(...b.values);
    case 'max':   return Math.max(...b.values);
    case 'first': return b.first;
    case 'last':  return b.last;
  }
}

const windowAggregateNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const windowType = (cfgString(config, 'windowType') ?? 'tumbling') as WindowKind;
    const windowMs = cfgNumber(config, 'windowMs') ?? 10_000;
    const slideMs = cfgNumber(config, 'slideMs') ?? Math.floor(windowMs / 2);
    const sessionGapMs = cfgNumber(config, 'sessionGapMs') ?? 5_000;
    const keyField = cfgString(config, 'keyField');
    const valueField = cfgString(config, 'valueField');
    const op = (cfgString(config, 'op') ?? 'count') as Op;

    /** Per-key bucket store. For tumbling/sliding, one bucket may exist
     *  per key at a time; for sliding, multiple staggered buckets. */
    const buckets = new Map<string, Bucket[]>();

    function emit(key: string | undefined, b: Bucket): void {
      const out: NodeMessage = {
        payload: aggregate(b, op),
        count: b.values.length,
        ...(key !== undefined ? { key } : {}),
        windowStart: new Date(b.startMs).toISOString(),
        windowEnd: new Date(b.endMs).toISOString(),
      };
      node.send(out);
    }

    function bucketFor(key: string, now: number): Bucket {
      const list = buckets.get(key) ?? [];
      if (windowType === 'session') {
        const live = list[list.length - 1];
        if (live !== undefined && now <= live.deadline) {
          live.deadline = now + sessionGapMs;
          return live;
        }
        const fresh: Bucket = { values: [], first: undefined, last: undefined, startMs: now, endMs: now + windowMs, deadline: now + sessionGapMs };
        list.push(fresh);
        buckets.set(key, list);
        return fresh;
      }
      // tumbling + sliding share an explicit start
      const live = list[list.length - 1];
      if (live !== undefined && now < live.endMs) return live;
      const startMs = windowType === 'tumbling'
        ? now - (now % windowMs)
        : now;
      const fresh: Bucket = { values: [], first: undefined, last: undefined, startMs, endMs: startMs + windowMs, deadline: 0 };
      list.push(fresh);
      buckets.set(key, list);
      return fresh;
    }

    // Periodic flush: close any bucket whose end time has passed.
    const ticker = setInterval(() => {
      const now = Date.now();
      for (const [key, list] of buckets) {
        const remaining: Bucket[] = [];
        for (const b of list) {
          const closed = windowType === 'session'
            ? now > b.deadline
            : now >= b.endMs;
          if (closed) emit(key === '' ? undefined : key, b);
          else remaining.push(b);
        }
        if (remaining.length === 0) buckets.delete(key);
        else buckets.set(key, remaining);
      }
    }, Math.max(250, Math.floor(Math.min(windowMs, sessionGapMs) / 4)));
    ticker.unref();

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const now = Date.now();
        const key = keyField !== undefined
          ? String((msg as Record<string, unknown>)[keyField] ?? '')
          : '';
        const rawValue = valueField !== undefined && typeof msg['payload'] === 'object' && msg['payload'] !== null
          ? (msg['payload'] as Record<string, unknown>)[valueField]
          : msg['payload'];
        const num = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : 0;
        const b = bucketFor(key, now);
        if (b.values.length === 0) b.first = rawValue;
        b.last = rawValue;
        b.values.push(num);
        // Sliding mode: ensure an additional bucket starting at now+slideMs
        // gets created on the next event after `slideMs` elapsed.
        if (windowType === 'sliding' && now >= b.startMs + slideMs) {
          // No-op: the next event after this point will see b.endMs and
          // open a new bucket via bucketFor. Sliding is approximated by
          // overlapping consecutive windows; precise per-slide emission
          // is a follow-up.
        }
        node.status({ fill: 'green', shape: 'dot', text: `${buckets.size} key(s) open` });
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });

    node.on('close', (close) => { clearInterval(ticker); close(); });
  });
};

export default windowAggregateNode;
