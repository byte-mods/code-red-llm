/**
 * Node-RED node: metronome
 *
 * Rate limiter / pacer. Three modes:
 *   - drop     drop messages that arrive faster than the rate
 *   - queue    queue messages and release at the rate (FIFO)
 *   - tick     ignore input timing and emit input messages on a tick
 *              (one queued msg per tick; backpressure-aware)
 *
 * Config:
 *   ratePerSec   target rate, messages per second
 *   mode         drop | queue | tick
 *   queueCap     max queued messages (queue/tick mode), default 1000
 *
 * Status icon shows current queue depth / drop count.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgNumber, cfgString } from './helpers.js';

const NODE_TYPE = 'metronome';
type Mode = 'drop' | 'queue' | 'tick';

const metronomeNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const ratePerSec = cfgNumber(config, 'ratePerSec') ?? 10;
    const mode = (cfgString(config, 'mode') ?? 'drop') as Mode;
    const queueCap = cfgNumber(config, 'queueCap') ?? 1_000;

    const periodMs = 1000 / Math.max(0.001, ratePerSec);
    const queue: NodeMessage[] = [];
    let lastFire = 0;
    let dropped = 0;

    function status(): void {
      node.status({
        fill: queue.length > 0 ? 'yellow' : 'green',
        shape: 'dot',
        text: `q=${queue.length} dropped=${dropped} @${ratePerSec}/s`,
      });
    }

    let ticker: NodeJS.Timeout | undefined;
    if (mode !== 'drop') {
      ticker = setInterval(() => {
        if (queue.length === 0) return;
        const m = queue.shift();
        if (m !== undefined) {
          node.send(m);
          status();
        }
      }, periodMs);
      ticker.unref();
    }

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        if (mode === 'drop') {
          const now = Date.now();
          if (now - lastFire >= periodMs) {
            lastFire = now;
            node.send(msg);
          } else {
            dropped += 1;
          }
          status();
          done();
          return;
        }
        // queue / tick
        if (queue.length >= queueCap) {
          dropped += 1;
        } else {
          queue.push(msg);
        }
        status();
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });

    node.on('close', (close) => {
      if (ticker !== undefined) clearInterval(ticker);
      close();
    });
  });
};

export default metronomeNode;
