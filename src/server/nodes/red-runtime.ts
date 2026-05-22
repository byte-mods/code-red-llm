/**
 * Minimal Node-RED runtime type surface for the nodes we register.
 *
 * The `RED` object passed to a node module exposes a much richer API than
 * what we typed in src/server/types.ts (which is plugin-focused). Nodes
 * need `RED.nodes.registerType`, `RED.nodes.createNode`, and message-bus
 * methods on the node instance.
 *
 * As with src/server/types.ts: narrow to what we use; extend rather than
 * reach for `any`.
 *
 * **Production note:** the connectors built on top of these types are
 * **demo-grade**. They open a fresh connection per `input` event in the
 * simplest cases; production deployments need connection pooling, retry
 * with backoff, circuit breakers, and detailed metrics. The patterns are
 * deliberately kept readable over optimised.
 */

/** Status icon hint Node-RED renders below a node. */
export interface NodeStatus {
  fill?: 'red' | 'green' | 'yellow' | 'blue' | 'grey';
  shape?: 'ring' | 'dot';
  text?: string;
}

/** One message on the Node-RED wire. Loosely typed — every flow is different. */
export interface NodeMessage {
  payload?: unknown;
  topic?: string;
  _msgid?: string;
  [k: string]: unknown;
}

/** The `this` for a registered node. */
export interface NodeInstance {
  id: string;
  type: string;
  name?: string;
  on(event: 'input', handler: (msg: NodeMessage, send: SendFn, done: DoneFn) => void): void;
  on(event: 'close', handler: (done: () => void) => void): void;
  /**
   * Send one or more messages downstream. The array form targets
   * multiple output ports by index; `null` skips that port. This is the
   * standard Node-RED runtime contract — see
   * https://nodered.org/docs/creating-nodes/node-js for the underlying API.
   */
  send(msg: NodeMessage | Array<NodeMessage | null>): void;
  status(s: NodeStatus): void;
  log(msg: unknown): void;
  warn(msg: unknown): void;
  error(msg: unknown, m?: NodeMessage): void;
}

/** Node-RED `send(msg)` for output. */
export type SendFn = (msg: NodeMessage | NodeMessage[]) => void;
/** Node-RED `done()` to ack message completion (Node-RED 1.x async API). */
export type DoneFn = (err?: Error) => void;

/** Constructor signature Node-RED expects for `registerType`. */
export type NodeConstructor<TConfig = Record<string, unknown>> = (
  this: NodeInstance,
  config: TConfig,
) => void;

/**
 * The shape of `RED.nodes` we touch. Real Node-RED exposes much more —
 * we keep this surface tight to the registration call.
 */
export interface NodesNamespace {
  registerType(type: string, ctor: NodeConstructor): void;
  createNode(node: NodeInstance, config: Record<string, unknown>): void;
}

/** The RED object passed to a node module. */
export interface NodeRED {
  nodes: NodesNamespace;
  log: { info(m: unknown): void; warn(m: unknown): void; error(m: unknown): void };
}

/** The default export shape of a Node-RED node module. */
export type NodeModule = (RED: NodeRED) => void;
