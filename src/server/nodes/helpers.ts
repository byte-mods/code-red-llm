/**
 * Common patterns shared across connector nodes.
 *
 * Every connector follows the same skeleton:
 *   1. read connection config from the node config
 *   2. on `input`, open or reuse a client, perform the op, send a result
 *   3. emit a status icon (yellow=working, green=ok, red=error)
 *   4. on `close`, dispose the client
 *
 * The factory below captures that skeleton so each connector becomes
 * ~30 lines of pure operation logic instead of ~100 lines of plumbing.
 */
import type {
  DoneFn,
  NodeInstance,
  NodeMessage,
  NodeRED,
  SendFn,
} from './red-runtime.js';

/**
 * Adapter API a connector implements. `init` produces a long-lived
 * client (or undefined if the connector opens per-op); `handle` runs
 * one operation per input message; `dispose` cleans up at node close.
 *
 * Generic `Client` lets each connector keep its driver type narrow
 * without leaking through helper boundaries.
 */
export interface ConnectorAdapter<Client> {
  /**
   * Open the long-lived client (pool, kafka producer, redis client …).
   * Called once at node creation. Return undefined to defer client
   * opening until the first `input` event.
   */
  init: () => Promise<Client | undefined>;
  /** Process one message. Return the value to set as `msg.payload`. */
  handle: (client: Client, msg: NodeMessage) => Promise<unknown>;
  /** Close the long-lived client. Called once at node close. */
  dispose: (client: Client) => Promise<void>;
}

/**
 * Build the Node-RED constructor body for a connector. Encapsulates the
 * status / send / done plumbing so each connector only writes its
 * driver-specific bits.
 */
export function makeConnectorNode<Client>(
  RED: NodeRED,
  config: Record<string, unknown>,
  adapter: ConnectorAdapter<Client>,
): (node: NodeInstance) => void {
  return (node: NodeInstance): void => {
    RED.nodes.createNode(node, config);

    // Eagerly open the client. If init rejects, surface as a red status —
    // the node is still usable but every message will fail until the
    // user fixes the config and redeploys.
    let clientP: Promise<Client | undefined> = adapter.init().catch((e) => {
      const err = e instanceof Error ? e : new Error(String(e));
      node.status({ fill: 'red', shape: 'ring', text: 'init: ' + err.message });
      node.error(err);
      throw err;
    });

    node.on('input', async (msg: NodeMessage, send: SendFn, done: DoneFn) => {
      try {
        node.status({ fill: 'yellow', shape: 'dot', text: 'working' });
        const client = await clientP;
        if (client === undefined) {
          throw new Error('connector client not initialised');
        }
        const payload = await adapter.handle(client, msg);
        const out: NodeMessage = { ...msg, payload };
        send(out);
        node.status({ fill: 'green', shape: 'dot', text: 'ok' });
        done();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 32) });
        node.error(err, msg);
        done(err);
      }
    });

    node.on('close', async (close) => {
      try {
        const client = await clientP.catch(() => undefined);
        if (client !== undefined) await adapter.dispose(client);
      } catch (e) {
        node.warn(e instanceof Error ? e.message : String(e));
      }
      close();
    });
  };
}

/** Read a string config field; trim; return undefined if empty/missing. */
export function cfgString(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Read a numeric config field. Returns undefined when missing/non-numeric. */
export function cfgNumber(config: Record<string, unknown>, key: string): number | undefined {
  const v = config[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Read a boolean config field. */
export function cfgBoolean(config: Record<string, unknown>, key: string): boolean {
  const v = config[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true';
  return false;
}
