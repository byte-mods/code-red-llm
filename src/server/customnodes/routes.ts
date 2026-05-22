/**
 * Admin routes for the custom-node authoring subsystem.
 *
 *   GET    /no-code-red/custom-nodes        — list every authored node
 *   POST   /no-code-red/custom-nodes        — create a new one (AI or manual)
 *   DELETE /no-code-red/custom-nodes/:name  — remove one
 *
 * After a successful create the route runs the project's build (`npm run
 * build`) so the new node is immediately discoverable on restart. The
 * caller is told to restart — Node-RED does not expose a clean way to
 * register new node types post-init.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Request, Response } from '../types.js';
import type {
  CreateCustomNodeRequest,
  CreateCustomNodeResponse,
} from './types.js';
import { listCustomNodes } from './registry.js';
import { generateCustomNode, writeCustomNode } from './generator.js';
import { reloadType } from '../reload/reloader.js';

function projectRoot(): string {
  return resolve(process.cwd());
}

function pkgPath(): string {
  return join(projectRoot(), 'package.json');
}

/**
 * Append `<name>` to package.json#node-red.nodes so the next restart
 * picks it up. Idempotent — duplicate keys are skipped.
 */
function registerInPackageJson(name: string): void {
  const raw = readFileSync(pkgPath(), 'utf-8');
  const pkg = JSON.parse(raw) as {
    'node-red'?: { nodes?: Record<string, string> };
  };
  if (pkg['node-red'] === undefined) pkg['node-red'] = {};
  if (pkg['node-red'].nodes === undefined) pkg['node-red'].nodes = {};
  const entry = `dist/custom-nodes/${name}.js`;
  if (pkg['node-red'].nodes[name] === entry) return;
  pkg['node-red'].nodes[name] = entry;
  writeFileSync(pkgPath(), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function unregisterFromPackageJson(name: string): void {
  const raw = readFileSync(pkgPath(), 'utf-8');
  const pkg = JSON.parse(raw) as {
    'node-red'?: { nodes?: Record<string, string> };
  };
  if (pkg['node-red']?.nodes?.[name] !== undefined) {
    delete pkg['node-red'].nodes[name];
    writeFileSync(pkgPath(), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }
}

/**
 * Run `npm run build` and resolve when it exits. Stderr is captured so
 * the route can surface a meaningful error to the operator.
 */
function runBuild(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolveBuild) => {
    let buf = '';
    const child = spawn('npm', ['run', 'build'], {
      cwd: projectRoot(),
      env: process.env,
    });
    child.stdout.on('data', (d: Buffer) => { buf += d.toString('utf-8'); });
    child.stderr.on('data', (d: Buffer) => { buf += d.toString('utf-8'); });
    child.on('close', (code) => resolveBuild({ ok: code === 0, output: buf.slice(-4000) }));
    child.on('error', (e) => resolveBuild({ ok: false, output: e.message }));
  });
}

export function handleListCustomNodes(_req: Request, res: Response): void {
  res.json({ nodes: listCustomNodes() });
}

export async function handleCreateCustomNode(req: Request, res: Response): Promise<void> {
  const body = (req as unknown as { body?: CreateCustomNodeRequest }).body;
  if (body === undefined || typeof body.name !== 'string' || typeof body.description !== 'string') {
    res.status(400).json({ error: 'body must include {name, description, generate, [tsSource, htmlSource]}' });
    return;
  }
  try {
    let result: { tsPath: string; htmlPath: string };
    if (body.generate) {
      result = await generateCustomNode({ name: body.name, description: body.description });
    } else {
      if (typeof body.tsSource !== 'string' || typeof body.htmlSource !== 'string') {
        res.status(400).json({ error: 'manual mode requires tsSource and htmlSource strings' });
        return;
      }
      result = writeCustomNode({ name: body.name, tsSource: body.tsSource, htmlSource: body.htmlSource });
    }
    registerInPackageJson(body.name);
    const build = await runBuild();
    if (!build.ok) {
      // Roll back: remove the registration entry so a broken file does
      // not break the next restart. Leave the .ts/.html on disk for
      // the user to fix.
      unregisterFromPackageJson(body.name);
      res.status(500).json({
        error: 'build failed — files were written but the registration was rolled back so restart is safe',
        files: { ts: result.tsPath, html: result.htmlPath },
        buildOutput: build.output,
      });
      return;
    }
    // Hot-reload the just-built node so it is live without a server
    // restart. The editor still needs a hard refresh to pick up the
    // new .html (palette is cached client-side), but the runtime
    // constructor is in place immediately.
    const reload = await reloadType(body.name);
    const response: CreateCustomNodeResponse = {
      name: body.name,
      tsPath: result.tsPath,
      htmlPath: result.htmlPath,
      generated: body.generate,
      hint: reload.ok
        ? 'Built and hot-reloaded. Hard-refresh the editor (Cmd-Shift-R) to see the new node in the palette.'
        : `Built, but hot-reload failed: ${reload.error ?? 'unknown'}. Restart the server to load.`,
    };
    res.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
}

export function handleDeleteCustomNode(req: Request, res: Response): void {
  const name = (req.params as Record<string, string> | undefined)?.['name'];
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) {
    res.status(400).json({ error: 'path param :name required (kebab-case)' });
    return;
  }
  const tsPath = join(projectRoot(), 'custom-nodes', `${name}.ts`);
  const htmlPath = join(projectRoot(), 'custom-nodes', `${name}.html`);
  let removed = 0;
  if (existsSync(tsPath)) { unlinkSync(tsPath); removed++; }
  if (existsSync(htmlPath)) { unlinkSync(htmlPath); removed++; }
  unregisterFromPackageJson(name);
  res.json({ ok: true, removed, hint: 'Restart to fully unload from the palette.' });
}
