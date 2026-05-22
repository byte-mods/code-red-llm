/**
 * Node-RED node: gate
 *
 * Pass-through filter that can be opened or closed by control messages.
 *
 * Behaviour:
 *   - Data messages (msg.control unset): forwarded only when the gate
 *     is open. Dropped silently when closed.
 *   - Control messages (msg.control === 'open' | 'close' | 'toggle'):
 *     change the gate state; not forwarded.
 *
 * Config:
 *   initial   'open' | 'closed' — state at startup
 *
 * Status icon reflects current state for at-a-glance debugging.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgString } from './helpers.js';

const NODE_TYPE = 'gate';

const gateNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const initial = (cfgString(config, 'initial') ?? 'open') === 'closed' ? false : true;
    let open = initial;

    function reflect(): void {
      node.status(open
        ? { fill: 'green', shape: 'dot', text: 'open' }
        : { fill: 'red', shape: 'ring', text: 'closed' });
    }
    reflect();

    node.on('input', (msg: NodeMessage, _send, done) => {
      const ctl = msg['control'];
      if (typeof ctl === 'string') {
        if (ctl === 'open') open = true;
        else if (ctl === 'close') open = false;
        else if (ctl === 'toggle') open = !open;
        reflect();
        done();
        return;
      }
      if (open) node.send(msg);
      done();
    });
  });
};

export default gateNode;
