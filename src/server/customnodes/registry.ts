/**
 * Discovers user-authored custom nodes under `<project>/custom-nodes/`
 * and (a) registers their compiled .js with Node-RED at plugin startup,
 * (b) provides a metadata listing for the sidebar UI.
 *
 * Discovery is purely directory-based — there is no manifest file. Any
 * `<name>.ts` that has a sibling `<name>.html` is considered a custom
 * node. At plugin load we look for the matching compiled `.js` under
 * `dist/custom-nodes/<name>.js`; if missing we surface a warning but
 * keep going (the rest of the plugin still works).
 *
 * Hot-reload note: Node-RED does not expose a clean way to register new
 * node types after init. New custom nodes therefore require a server
 * restart to appear in the palette. The UI surfaces this clearly.
 */
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CustomNodeSummary } from './types.js';
import type { NodeRED } from '../nodes/red-runtime.js';

/**
 * Root of the custom-nodes source tree. Resolved relative to the cwd —
 * which is the project root when `npm run dev` runs.
 */
function srcRoot(): string {
  return resolve(process.cwd(), 'custom-nodes');
}

/**
 * Root of the compiled output. Mirrors the src tree shape so a custom
 * node `custom-nodes/foo.ts` becomes `dist/custom-nodes/foo.js` after
 * `npm run build`.
 */
function distRoot(): string {
  return resolve(process.cwd(), 'dist', 'custom-nodes');
}

/**
 * Scan the source tree and return one summary per discovered custom
 * node. Order is alphabetical by name for stable UI rendering.
 */
export function listCustomNodes(): CustomNodeSummary[] {
  const root = srcRoot();
  if (!existsSync(root)) return [];
  const out: CustomNodeSummary[] = [];
  for (const file of readdirSync(root)) {
    if (!file.endsWith('.ts')) continue;
    const name = file.slice(0, -3);
    const tsPath = join(root, file);
    const htmlPath = join(root, `${name}.html`);
    if (!existsSync(htmlPath)) continue;
    const distJs = join(distRoot(), `${name}.js`);
    const built = existsSync(distJs);
    const mtime = statSync(tsPath).mtimeMs;
    out.push({ name, visibility: 'public', tsPath, htmlPath, built, mtime });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Dynamic-import every compiled custom node and call its default export
 * with the live RED runtime so each registers itself.
 *
 * Errors per-node are isolated — one broken custom node should not
 * prevent the others from loading.
 */
export async function loadCustomNodes(RED: NodeRED): Promise<{ loaded: string[]; failed: Array<{ name: string; error: string }> }> {
  const summaries = listCustomNodes();
  const loaded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const s of summaries) {
    if (!s.built) {
      failed.push({ name: s.name, error: 'no compiled .js — run `npm run build` and restart' });
      continue;
    }
    const distJs = join(distRoot(), `${s.name}.js`);
    try {
      const mod: { default?: (RED: NodeRED) => void } = await import(pathToFileURL(distJs).href);
      if (typeof mod.default !== 'function') {
        failed.push({ name: s.name, error: 'module has no default export function' });
        continue;
      }
      mod.default(RED);
      loaded.push(s.name);
    } catch (e) {
      failed.push({ name: s.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { loaded, failed };
}
