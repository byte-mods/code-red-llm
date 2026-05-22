#!/usr/bin/env node
/**
 * Local Node-RED launcher for development.
 *
 * Why a script rather than `node-red --userDir dev-config`:
 *  - We need to seed a `nodes/` symlink so Node-RED discovers our compiled
 *    plugin without us having to `npm link` ourselves into a separate userDir.
 *  - We want to ensure dist/ exists before launch (the build script already
 *    runs first, but a stale-state guard catches manual mistakes).
 *  - We want a single place to set NODE_RED_HOME / PORT defaults.
 *
 * Operational notes:
 *  - Listens on http://localhost:1880
 *  - Editor: http://localhost:1880/
 *  - Health: http://localhost:1880/no-code-red/health
 *  - dev-config/ is created on first run and gitignored.
 *  - The whole project root is registered as a Node-RED `nodesDir` so the
 *    package.json#node-red.plugins entry is picked up directly.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = resolve(fileURLToPath(import.meta.url), '../..');
const userDir = resolve(__root, 'dev-config');
const distEntry = resolve(__root, 'dist/server/plugin.js');

if (!existsSync(distEntry)) {
  console.error(`dev: missing ${distEntry} — run "npm run build" first.`);
  process.exit(1);
}

mkdirSync(userDir, { recursive: true });

const RED = (await import('node-red')).default;
const http = await import('node:http');
const express = (await import('express')).default;

const app = express();
const server = http.createServer(app);

// `nodesDir` tells Node-RED to scan an additional directory for installable
// modules. Passing the project root makes our package.json#node-red.plugins
// entry visible without polluting userDir/node_modules.
RED.init(server, {
  httpAdminRoot: '/',
  httpNodeRoot: '/api',
  userDir,
  nodesDir: [__root],
  flowFile: 'flows.json',
  logging: {
    console: { level: 'info', metrics: false, audit: false },
  },
  editorTheme: {
    // Enable Node-RED's built-in multi-file projects (S10). Users can
    // now create git-tracked projects with multiple flow files and use
    // Subflows for cross-file function reuse — both first-class
    // Node-RED features that just need this flag flipped.
    projects: { enabled: true },
    page: { title: 'Node Red LLM' },
    header: { title: 'Node Red LLM' },
  },
});

app.use(RED.settings.httpAdminRoot, RED.httpAdmin);
app.use(RED.settings.httpNodeRoot, RED.httpNode);

const port = Number(process.env.PORT ?? 1880);
server.listen(port, () => {
  console.warn(`no_code_red dev server: http://localhost:${port}/`);
  console.warn(`           health probe: http://localhost:${port}/no-code-red/health`);
});

await RED.start();
