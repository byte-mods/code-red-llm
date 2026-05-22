/**
 * Node-RED node: stream-join
 *
 * Inner equi-join of two logical streams on a shared key, with a
 * windowed match horizon. Use msg.stream='left' or 'right' on the
 * input to identify which side the message came from.
 *
 * Config:
 *   keyField     msg path to the join key (e.g. "orderId" reads msg.orderId)
 *   windowMs     match horizon: pairs only joined within this window
 *
 * Output msg:
 *   msg.payload = { left, right }
 *   msg.key     = the join key
 *
 * Demo-grade: state is in-process. State-recovery and exactly-once
 * semantics are out of scope.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString } from './helpers.js';

const NODE_TYPE = 'stream-join';

interface Buffered { msg: NodeMessage; t: number }

const streamJoinNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const keyField = cfgString(config, 'keyField') ?? 'key';
    const windowMs = cfgNumber(config, 'windowMs') ?? 30_000;

    const leftBuf = new Map<string, Buffered[]>();
    const rightBuf = new Map<string, Buffered[]>();

    function readKey(msg: NodeMessage): string | undefined {
      const v = (msg as Record<string, unknown>)[keyField];
      if (v === undefined || v === null) return undefined;
      return String(v);
    }

    function purge(buf: Map<string, Buffered[]>, now: number): void {
      for (const [k, list] of buf) {
        const keep = list.filter((x) => now - x.t <= windowMs);
        if (keep.length === 0) buf.delete(k);
        else buf.set(k, keep);
      }
    }

    function tryEmit(key: string): void {
      const ls = leftBuf.get(key) ?? [];
      const rs = rightBuf.get(key) ?? [];
      if (ls.length === 0 || rs.length === 0) return;
      // Greedy: pair the oldest left with the oldest right, repeat.
      while (ls.length > 0 && rs.length > 0) {
        const l = ls.shift()!;
        const r = rs.shift()!;
        node.send({ payload: { left: l.msg.payload, right: r.msg.payload }, key });
      }
      if (ls.length === 0) leftBuf.delete(key); else leftBuf.set(key, ls);
      if (rs.length === 0) rightBuf.delete(key); else rightBuf.set(key, rs);
    }

    const ticker = setInterval(() => {
      const now = Date.now();
      purge(leftBuf, now);
      purge(rightBuf, now);
      node.status({ fill: 'blue', shape: 'dot', text: `L=${leftBuf.size} R=${rightBuf.size}` });
    }, Math.max(500, Math.floor(windowMs / 4)));
    ticker.unref();

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const key = readKey(msg);
        if (key === undefined) {
          node.warn(`stream-join: dropping msg with no ${keyField}`);
          done();
          return;
        }
        const side = msg['stream'] === 'right' ? 'right' : 'left';
        const buf = side === 'left' ? leftBuf : rightBuf;
        const list = buf.get(key) ?? [];
        list.push({ msg, t: Date.now() });
        buf.set(key, list);
        tryEmit(key);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });

    node.on('close', (close) => { clearInterval(ticker); close(); });
  });
};

export default streamJoinNode;
