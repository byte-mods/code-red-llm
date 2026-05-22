#!/usr/bin/env node
/**
 * Production launcher — lean cousin of scripts/dev.mjs.
 *
 * Differences from dev.mjs:
 *  - No build step (the Dockerfile already ran it).
 *  - userDir is configurable via NRED_USER_DIR; defaults to /data inside the
 *    container so it's easy to mount as a volume.
 *  - Logging is structured and verbose at info — production logs go to
 *    container stdout for collection by whatever orchestrator runs us.
 *  - Editor projects feature stays disabled until S6 wires real persistence.
 *
 * Required env (with defaults):
 *  PORT             - HTTP port, default 1880
 *  NRED_USER_DIR    - Node-RED user dir (flows + creds), default /data
 */
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __root = resolve(fileURLToPath(import.meta.url), '../..');
const distEntry = resolve(__root, 'dist/server/plugin.js');
const userDir = process.env.NRED_USER_DIR ?? '/data';
const port = Number(process.env.PORT ?? 1880);

if (!existsSync(distEntry)) {
  console.error(`start: missing ${distEntry} — image is not built correctly.`);
  process.exit(1);
}

mkdirSync(userDir, { recursive: true });

const RED = (await import('node-red')).default;
const http = await import('node:http');
const express = (await import('express')).default;

const app = express();
const server = http.createServer(app);

RED.init(server, {
  httpAdminRoot: '/',
  httpNodeRoot: '/api',
  userDir,
  nodesDir: [__root],
  flowFile: 'flows.json',
  logging: {
    console: { level: 'info', metrics: false, audit: true },
  },
  editorTheme: { projects: { enabled: false } },
});

app.use(RED.settings.httpAdminRoot, RED.httpAdmin);
app.use(RED.settings.httpNodeRoot, RED.httpNode);

server.listen(port, '0.0.0.0', () => {
  console.warn(`no_code_red: listening on 0.0.0.0:${port}`);
});

const shutdown = async (sig) => {
  console.warn(`no_code_red: ${sig} received, shutting down`);
  try {
    await RED.stop();
  } catch (e) {
    console.error('no_code_red: error during RED.stop()', e);
  }
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await RED.start();
