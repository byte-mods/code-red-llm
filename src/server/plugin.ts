/**
 * no_code_red — Node-RED plugin entry point.
 *
 * Responsibilities of this skeleton (S1.T3):
 *  - Register a `node-red-plugin` descriptor under the id `no-code-red` so the
 *    editor discovers and loads our sidebar resources.
 *  - Mount one admin route — `GET /no-code-red/health` — that returns a static
 *    liveness payload. This is the integration smoke signal: if curl returns
 *    {ok: true, plugin: 'no-code-red'}, the plugin has been loaded by the
 *    Node-RED runtime end-to-end.
 *  - Log a one-line banner at startup so a developer running `npm run dev`
 *    sees evidence the plugin booted.
 *
 * Why a *plugin* rather than a *node*: nodes appear on the palette and run as
 * part of user flows. We are not a flow node — we are an editor-extension
 * that ships a sidebar tab and admin endpoints. That is exactly what
 * Node-RED's plugin API is for.
 *
 * Future tasks extend this file:
 *  - S2 wires the `/no-code-red/generate` admin route to a Claude subprocess.
 *  - S4 makes that route stream Server-Sent Events.
 *  - S5 ships the real sidebar UI (this task only registers a placeholder).
 *
 * Hard invariants the rest of the codebase relies on:
 *  - The default export is a synchronous function `(RED) => void`.
 *  - The plugin id passed to `RED.plugins.registerPlugin` matches the key in
 *    `package.json#node-red.plugins`. A mismatch silently disables discovery.
 *  - All admin routes are mounted under the `/no-code-red` prefix so we never
 *    collide with other plugins or with Node-RED's own admin routes.
 */
import { resolve } from 'node:path';

import type { Request, Response, RED, PluginFactory } from './types.js';
import {
  handleGenerate,
  handleListGenerations,
  handleCancelGeneration,
} from './sse/index.js';
import { handleValidate } from './flow/index.js';
import { GenerationRegistry, HistoryWriter } from './session/index.js';
import {
  handleListCustomNodes,
  handleCreateCustomNode,
  handleDeleteCustomNode,
} from './customnodes/index.js';
import {
  handleListTracers,
  handleTracerEvents,
  handlePauseTracer,
  handleResumeTracer,
  handleStepTracer,
} from './tracer/index.js';
import {
  captureRED,
  handleReloadAll,
  handleReloadOne,
} from './reload/index.js';

/** Canonical plugin id — referenced by package.json#node-red.plugins. */
export const PLUGIN_ID = 'no-code-red';

/** Admin route prefix — keep all routes under this namespace. */
export const ADMIN_PREFIX = '/no-code-red';

/**
 * The static payload `/health` returns. Exposed for tests so they can assert
 * against a single source of truth instead of duplicating the literal.
 */
export const HEALTH_PAYLOAD = Object.freeze({
  ok: true,
  plugin: PLUGIN_ID,
  version: '0.1.0',
});

/**
 * Plugin entry. Idempotent w.r.t. logging — Node-RED will call this exactly
 * once during runtime startup, so we do not guard against re-entry.
 */
const plugin: PluginFactory = (RED: RED): void => {
  // Capture RED for the hot-reload subsystem so reloads can re-call
  // RED.nodes.registerType from outside this factory.
  captureRED(RED);

  // Per-plugin singletons constructed up front so the `onremove`
  // closure can reach them. In-memory generation registry + per-
  // generation history writer factory. No module-level globals.
  const registry = new GenerationRegistry();
  const historyRoot = resolve(process.cwd(), '.no-code-red');
  const historyFor = (generationId: string): HistoryWriter =>
    new HistoryWriter(historyRoot, generationId, (err) => {
      RED.log.warn(`[${PLUGIN_ID}] history write failed: ${err.message}`);
    });

  RED.plugins.registerPlugin(PLUGIN_ID, {
    type: 'node-red-plugin',
    onremove: () => {
      // RED.stop() triggers `onremove`. Cancel every in-flight
      // generation so subprocesses are SIGTERM'd before the host exits.
      // The bridge already escalates to SIGKILL after killGraceMs.
      registry.cancelAll();
    },
  });

  RED.httpAdmin.get(`${ADMIN_PREFIX}/health`, (_req: Request, res: Response) => {
    res.json(HEALTH_PAYLOAD);
  });

  RED.httpAdmin.post(`${ADMIN_PREFIX}/validate`, (req: Request, res: Response) => {
    handleValidate(req, res);
  });

  // SSE generation endpoint — streams validated Node-RED nodes derived
  // from a natural-language prompt via the Claude CLI. See
  // src/server/sse/generate.ts for the wire shape and lifecycle.
  RED.httpAdmin.get(`${ADMIN_PREFIX}/generate`, (req: Request, res: Response) => {
    // Express does not await async handlers; we fire-and-forget here.
    // The handler itself owns lifecycle (SSE close, cancel, done frame),
    // and any rejection is already trapped inside `handleGenerate`.
    void handleGenerate(req, res, { registry, historyFor });
  });

  // Inspector: list active generations.
  RED.httpAdmin.get(`${ADMIN_PREFIX}/generations`, (req: Request, res: Response) => {
    handleListGenerations(req, res, registry);
  });

  // Explicit cancel by id (separate from client-disconnect cancel, which
  // is already wired inside handleGenerate via req.on('close')).
  RED.httpAdmin.post(`${ADMIN_PREFIX}/generations/:id/cancel`, (req: Request, res: Response) => {
    handleCancelGeneration(req, res, registry);
  });

  // Custom-node authoring (S10). List existing, create new (AI-generated
  // or manual), delete. Create runs `npm run build` and registers in
  // package.json#node-red.nodes — a server restart loads the new node.
  RED.httpAdmin.get(`${ADMIN_PREFIX}/custom-nodes`, handleListCustomNodes);
  RED.httpAdmin.post(`${ADMIN_PREFIX}/custom-nodes`, (req: Request, res: Response) => {
    void handleCreateCustomNode(req, res);
  });
  RED.httpAdmin.delete(`${ADMIN_PREFIX}/custom-nodes/:name`, handleDeleteCustomNode);

  // Tracer subsystem (S13). One node type `tracer` is registered via the
  // normal node loader path; these admin routes drive the per-instance
  // pause/resume/step controls from the sidebar.
  RED.httpAdmin.get(`${ADMIN_PREFIX}/tracers`, handleListTracers);
  RED.httpAdmin.get(`${ADMIN_PREFIX}/tracers/events`, handleTracerEvents);
  RED.httpAdmin.post(`${ADMIN_PREFIX}/tracers/:id/pause`, handlePauseTracer);
  RED.httpAdmin.post(`${ADMIN_PREFIX}/tracers/:id/resume`, handleResumeTracer);
  RED.httpAdmin.post(`${ADMIN_PREFIX}/tracers/:id/step`, handleStepTracer);

  // Hot module reload (S14). POST /reload re-registers every node in
  // package.json#node-red.nodes by dynamic-importing its compiled .js
  // with cache busting; /reload/:name does one. Re-deploying the flow
  // in the editor activates the new code for existing instances.
  RED.httpAdmin.post(`${ADMIN_PREFIX}/reload`, (req: Request, res: Response) => {
    void handleReloadAll(req, res);
  });
  RED.httpAdmin.post(`${ADMIN_PREFIX}/reload/:name`, (req: Request, res: Response) => {
    void handleReloadOne(req, res);
  });

  RED.log.info(`[${PLUGIN_ID}] plugin loaded; admin routes mounted at ${ADMIN_PREFIX}`);
};

export default plugin;
