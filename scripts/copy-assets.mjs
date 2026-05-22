#!/usr/bin/env node
/**
 * Post-build asset copier.
 *
 * tsc only emits .ts → .js. Node-RED's plugin loader looks for a matching
 * .html file next to the .js entry to serve sidebar resources. Until S5
 * introduces a real client bundler, we hand-copy the single HTML asset.
 *
 * Why a .mjs script rather than `cpx` / `shx`: zero extra deps, runs on any
 * Node we support, and the failure mode (missing source) is obvious from the
 * stack trace.
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// 1) Sidebar HTML.
const assets = [{ src: 'src/client/sidebar.html', dst: 'dist/server/plugin.html' }];

// 2) Each Node-RED node has a .ts compiled by tsc + a .html config form
//    that we must place next to the emitted .js. We discover .html files
//    under src/server/nodes/ and mirror them to dist/.
const nodesSrcDir = 'src/server/nodes';
if (existsSync(nodesSrcDir)) {
  for (const file of readdirSync(nodesSrcDir)) {
    if (!file.endsWith('.html')) continue;
    const src = join(nodesSrcDir, file);
    if (!statSync(src).isFile()) continue;
    assets.push({ src, dst: join('dist/server/nodes', file) });
  }
}

// 3) User-authored custom nodes live under custom-nodes/ at project root
//    (created by the sidebar UI or hand-edited). Copy their .html siblings
//    so dist/custom-nodes/<name>.html sits next to dist/custom-nodes/<name>.js.
const customNodesDir = 'custom-nodes';
if (existsSync(customNodesDir)) {
  for (const file of readdirSync(customNodesDir)) {
    if (!file.endsWith('.html')) continue;
    const src = join(customNodesDir, file);
    if (!statSync(src).isFile()) continue;
    assets.push({ src, dst: join('dist/custom-nodes', file) });
  }
}

let copied = 0;
for (const { src, dst } of assets) {
  if (!existsSync(src)) {
    console.error(`copy-assets: missing source ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied += 1;
}

console.warn(`copy-assets: copied ${copied} file(s).`);
