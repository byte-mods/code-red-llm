/**
 * Hot module reload for Node-RED node modules.
 *
 * Workflow:
 *   1. User edits / creates a custom node, or someone re-builds an
 *      existing connector.
 *   2. POST /no-code-red/reload (or /reload/:name) hits one of our routes.
 *   3. This module dynamic-imports the new `.js` with a cache-busting
 *      query string and calls its default export with the live RED
 *      reference captured at plugin init.
 *   4. Inside, the module calls `RED.nodes.registerType('foo', ctor)`
 *      a second time. Node-RED 4's type registry stores the constructor
 *      in a Map keyed by type name — re-registration replaces it.
 *   5. Existing deployed instances keep using the old constructor closure
 *      until the flow is re-deployed (Node-RED's normal lifecycle).
 *      Re-deploy in the editor → new instances use the new code.
 *
 * Honest scope:
 *   - We cannot mutate already-running node instances; that requires a
 *     flow re-deploy.
 *   - The editor's palette HTML is cached client-side at first load.
 *     If the HTML changed (new fields, label fn, etc.), the user must
 *     hard-refresh the editor (Cmd-Shift-R).
 *   - Cache-busting via query string only works on ESM dynamic import
 *     in Node 20+ — we already require Node >= 20 in engines.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let reloadCounter = 0;

import type { NodeRED } from '../nodes/red-runtime.js';

/** RED reference captured at plugin init so reload paths can re-call registerType. */
let capturedRED: NodeRED | undefined;

/** Set once at plugin init. Safe to call multiple times (idempotent). */
export function captureRED(RED: NodeRED): void {
  capturedRED = RED;
}

export interface ReloadResult {
  readonly name: string;
  readonly ok: boolean;
  readonly distPath: string;
  readonly error?: string;
}

/** Read package.json#node-red.nodes — single source of truth for what is loadable. */
function readRegisteredNodes(): Record<string, string> {
  const pkgPath = resolve(process.cwd(), 'package.json');
  const raw = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as { 'node-red'?: { nodes?: Record<string, string> } };
  return pkg['node-red']?.nodes ?? {};
}

/**
 * Reload one node module by type id. Returns a ReloadResult — never
 * throws (errors are surfaced via `result.error`).
 */
export async function reloadType(name: string): Promise<ReloadResult> {
  if (capturedRED === undefined) {
    return { name, ok: false, distPath: '', error: 'reloader: RED reference not captured at plugin init' };
  }
  const registered = readRegisteredNodes();
  const relativeDist = registered[name];
  if (relativeDist === undefined) {
    return { name, ok: false, distPath: '', error: `not in package.json#node-red.nodes` };
  }
  const distPath = resolve(process.cwd(), relativeDist);
  if (!existsSync(distPath)) {
    return { name, ok: false, distPath, error: `compiled file missing — run npm run build first` };
  }
  try {
    // Cache-busted dynamic import. Each reload gets a fresh module instance.
    // The monotonic counter guarantees uniqueness even when two reloads land
    // inside the same millisecond (common in tests and fast dev loops).
    const url = pathToFileURL(distPath).href + `?t=${Date.now()}-${++reloadCounter}`;
    const mod: { default?: (RED: NodeRED) => void } = await import(url);
    if (typeof mod.default !== 'function') {
      return { name, ok: false, distPath, error: 'module has no default-export function' };
    }
    // Calling registerType a second time on Node-RED 4 replaces the
    // constructor in the type registry. If this ever changes behaviour
    // in a future Node-RED version we surface the underlying error.
    mod.default(capturedRED);
    return { name, ok: true, distPath };
  } catch (e) {
    return { name, ok: false, distPath, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reload every node module listed in package.json#node-red.nodes.
 * Results are returned in registration order; one failure does not
 * stop the others.
 */
export async function reloadAll(): Promise<ReloadResult[]> {
  const registered = readRegisteredNodes();
  const out: ReloadResult[] = [];
  for (const name of Object.keys(registered)) {
    out.push(await reloadType(name));
  }
  return out;
}
