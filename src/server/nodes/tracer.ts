/**
 * Node-RED node: tracer
 *
 * Step-through debugger as a wire-segment. Sits between any two nodes.
 * In `running` mode it is pass-through. In `paused` mode it holds every
 * arriving message and waits for the sidebar (or the admin route) to
 * release them one-by-one (`/tracer/:id/step`) or all-at-once
 * (`/tracer/:id/resume`).
 *
 * State + control live in src/server/tracer/bus.ts — the bus is a
 * process-global singleton that the sidebar SSE stream subscribes to.
 *
 * Status icon shows mode + held depth so flows can be inspected by eye.
 *
 * Safe in production: default mode is `running`, so an undeployed
 * paused tracer never accidentally blocks live traffic.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString } from './helpers.js';
import { tracerBus } from '../tracer/bus.js';

const NODE_TYPE = 'tracer';

const tracerNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const initialMode = cfgString(config, 'initialMode') === 'paused' ? 'paused' : 'running';

    // Hook the bus closes over `node.send` so resume/step calls
    // can release msgs back through this very tracer's output port.
    tracerBus.register(node.id, node.name, initialMode, (msg) => {
      node.send(msg);
    });
    refreshStatus();

    function refreshStatus(): void {
      const snap = tracerBus.snapshot(node.id);
      if (snap === undefined) return;
      node.status({
        fill: snap.mode === 'paused' ? 'red' : 'green',
        shape: snap.mode === 'paused' ? 'ring' : 'dot',
        text: `${snap.mode} · ${snap.heldCount} held · ${snap.seenCount} seen`,
      });
    }
    // The bus emits 'changed' on every state mutation; re-derive status.
    tracerBus.on('changed', (s) => { if (s.id === node.id) refreshStatus(); });

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const releaseNow = tracerBus.ingest(node.id, msg);
        if (releaseNow) node.send(msg);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });

    node.on('close', (close) => {
      tracerBus.unregister(node.id);
      close();
    });
  });
};

export default tracerNode;
