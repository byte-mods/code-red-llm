/**
 * Node-RED node: pattern-match
 *
 * Detects a sequence of event types within a per-key window. The
 * sequence is a comma-separated list of event names (e.g.
 * "login,view-cart,checkout") matched against `msg.payload[eventField]`
 * (or msg.payload if no field). When all events in the sequence are
 * observed in order for the same key within `windowMs`, emit one
 * synthesised message carrying the full chain.
 *
 * Config:
 *   sequence     CSV list of event names
 *   keyField     msg field to group by
 *   eventField   path inside msg.payload (omit if payload is the event string)
 *   windowMs     max time between first and last event for a match
 *
 * Output msg:
 *   msg.payload  array of the matched messages in order
 *   msg.key      group key
 *   msg.matched  ISO timestamp of the closing event
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString } from './helpers.js';

const NODE_TYPE = 'pattern-match';

interface Progress {
  /** index of the next event the pattern expects */
  nextStep: number;
  /** the chain of messages matched so far */
  chain: NodeMessage[];
  /** ms timestamp of the first matched event */
  firstMs: number;
}

const patternMatchNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const sequence = (cfgString(config, 'sequence') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
    const keyField = cfgString(config, 'keyField') ?? 'key';
    const eventField = cfgString(config, 'eventField');
    const windowMs = cfgNumber(config, 'windowMs') ?? 60_000;

    if (sequence.length === 0) {
      node.status({ fill: 'red', shape: 'ring', text: 'empty sequence' });
      node.error(new Error('pattern-match: sequence config is empty'));
      return;
    }

    const inFlight = new Map<string, Progress>();

    function eventName(msg: NodeMessage): string {
      const payload = msg['payload'];
      if (eventField !== undefined && typeof payload === 'object' && payload !== null) {
        return String((payload as Record<string, unknown>)[eventField] ?? '');
      }
      return String(payload ?? '');
    }

    // Periodic sweep: drop progress entries that exceeded the window.
    const ticker = setInterval(() => {
      const now = Date.now();
      for (const [k, p] of inFlight) {
        if (now - p.firstMs > windowMs) inFlight.delete(k);
      }
      node.status({ fill: 'blue', shape: 'dot', text: `${inFlight.size} key(s) tracking` });
    }, Math.max(500, Math.floor(windowMs / 6)));
    ticker.unref();

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const key = String((msg as Record<string, unknown>)[keyField] ?? '');
        if (key === '') {
          node.warn(`pattern-match: dropping msg with no ${keyField}`);
          done();
          return;
        }
        const evt = eventName(msg);
        const now = Date.now();

        let p = inFlight.get(key);
        if (p === undefined) {
          // Only start tracking if the event matches step 0.
          if (evt === sequence[0]) {
            p = { nextStep: 1, chain: [msg], firstMs: now };
            inFlight.set(key, p);
          }
        } else {
          // Window expired? Reset.
          if (now - p.firstMs > windowMs) {
            inFlight.delete(key);
            if (evt === sequence[0]) {
              inFlight.set(key, { nextStep: 1, chain: [msg], firstMs: now });
            }
          } else if (evt === sequence[p.nextStep]) {
            p.chain.push(msg);
            p.nextStep += 1;
            if (p.nextStep >= sequence.length) {
              // Match — emit and reset.
              node.send({ payload: p.chain.map((m) => m.payload), key, matched: new Date(now).toISOString() });
              inFlight.delete(key);
            }
          }
          // Out-of-order events just don't advance progress; they don't
          // reset it. That's looser than CEP "strict contiguity" — for
          // tighter matching, reset on mismatch.
        }
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });

    node.on('close', (close) => { clearInterval(ticker); close(); });
  });
};

export default patternMatchNode;
