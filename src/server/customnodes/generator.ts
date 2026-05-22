/**
 * AI-assisted custom-node generation.
 *
 * Given a description, ask Claude to emit a .ts file (following the
 * existing connector pattern) + a matching .html config form. The
 * route layer writes both to disk and tells the user to restart.
 *
 * We deliberately constrain Claude's output with a single template
 * shown in the prompt — same pattern as the existing built-in
 * connectors — so the generated code drops in without surgery.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

/**
 * Build the prompt that gives Claude the contract for emitting one
 * custom node. The reference TS file is read at runtime so the prompt
 * always reflects the current pattern.
 */
function buildPrompt(name: string, description: string, helpersSrc: string, exampleSrc: string): string {
  return [
    'You are generating a Node-RED custom node for the no_code_red plugin.',
    '',
    'Follow the EXACT pattern shown in the example below. Required surface:',
    `  - export default a NodeModule function ((RED) => void)`,
    `  - inside, call RED.nodes.registerType('${name}', function (this, config) { … })`,
    `  - read config via cfgString / cfgNumber / cfgBoolean from "./helpers.js"`,
    `  - use makeConnectorNode<Client> from "./helpers.js" so status/send/done are uniform`,
    '',
    'Helpers source (read-only, do NOT include in output — already exists):',
    '```ts',
    helpersSrc,
    '```',
    '',
    'Example existing connector (postgres) — emit a file shaped like this:',
    '```ts',
    exampleSrc,
    '```',
    '',
    'Now generate two files for a new custom node:',
    `  Name (kebab-case node type id): ${name}`,
    `  Description: ${description}`,
    '',
    'Output EXACTLY this format, two fenced code blocks back-to-back, nothing else:',
    '',
    '```ts',
    '<the .ts file contents>',
    '```',
    '',
    '```html',
    '<the .html config form contents — matching pattern of postgres.html: a registerType script, a data-template-name script, a data-help-name script>',
    '```',
    '',
    'Constraints:',
    '  - Imports relative to src/server/nodes/. Use "./helpers.js" and "./red-runtime.js" — those WILL resolve because custom nodes compile to dist/custom-nodes/ which sits next to dist/server/nodes/. Adjust import paths to "../server/nodes/helpers.js" and "../server/nodes/red-runtime.js" (note: from custom-nodes/ source, ../server/nodes/ is the helpers location).',
    '  - No new npm dependencies — only use packages already in package.json or Node-RED built-ins (node:fetch, node:fs, node:crypto, node:url, etc.).',
    '  - If the node performs a long-lived connection (db, queue), use makeConnectorNode; if it is a source/timer/transform, write the registerType callback directly (see scheduler.ts for that pattern — but you may not see it here).',
    '  - Add concise doc comments at the top of the .ts file.',
    '  - The HTML must register the node type id exactly as the .ts file does.',
  ].join('\n');
}

/**
 * Parse Claude's response: two adjacent fenced code blocks, first ts,
 * then html. Tolerates extra whitespace and language tags.
 */
function parseBlocks(text: string): { ts: string; html: string } {
  const re = /```(?:ts|typescript)\n([\s\S]*?)\n```\s*```(?:html)\n([\s\S]*?)\n```/;
  const m = text.match(re);
  if (m === null || m[1] === undefined || m[2] === undefined) {
    throw new Error('generator: could not parse ts + html code blocks from response');
  }
  return { ts: m[1], html: m[2] };
}

/**
 * Generate and write a new custom node from a description.
 * Returns the paths of the written files.
 */
export async function generateCustomNode(opts: {
  name: string;
  description: string;
  apiKey?: string;
}): Promise<{ tsPath: string; htmlPath: string }> {
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined || apiKey === '') {
    throw new Error('generator: ANTHROPIC_API_KEY env (or apiKey opt) required');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(opts.name)) {
    throw new Error('generator: name must be lowercase kebab-case, starting with a letter');
  }

  // Read reference files so the prompt always reflects current patterns.
  const here = dirname(fileURLToPath(import.meta.url));
  // After build: dirname is dist/server/customnodes/. Resolve the
  // src tree relative to project root for predictability.
  const projectRoot = resolve(process.cwd());
  const helpersSrc = readFileSync(join(projectRoot, 'src/server/nodes/helpers.ts'), 'utf-8');
  const exampleSrc = readFileSync(join(projectRoot, 'src/server/nodes/postgres.ts'), 'utf-8');
  // Reference `here` so it doesn't trip "noUnusedLocals" while still
  // documenting the runtime location.
  void here;

  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: buildPrompt(opts.name, opts.description, helpersSrc, exampleSrc) }],
  });

  const text = resp.content
    .map((b) => (typeof b === 'object' && b !== null && 'type' in b && b.type === 'text' && 'text' in b && typeof b.text === 'string' ? b.text : ''))
    .filter((s) => s !== '')
    .join('\n');

  const { ts, html } = parseBlocks(text);

  const customDir = resolve(projectRoot, 'custom-nodes');
  mkdirSync(customDir, { recursive: true });
  const tsPath = join(customDir, `${opts.name}.ts`);
  const htmlPath = join(customDir, `${opts.name}.html`);
  if (existsSync(tsPath) || existsSync(htmlPath)) {
    throw new Error(`generator: a custom node named "${opts.name}" already exists`);
  }
  writeFileSync(tsPath, ts, 'utf-8');
  writeFileSync(htmlPath, html, 'utf-8');
  return { tsPath, htmlPath };
}

/**
 * Write a user-supplied .ts + .html (the "manual mode" path).
 * No AI in the loop — the caller provides both files verbatim.
 */
export function writeCustomNode(opts: {
  name: string;
  tsSource: string;
  htmlSource: string;
}): { tsPath: string; htmlPath: string } {
  if (!/^[a-z][a-z0-9-]*$/.test(opts.name)) {
    throw new Error('generator: name must be lowercase kebab-case');
  }
  const projectRoot = resolve(process.cwd());
  const customDir = resolve(projectRoot, 'custom-nodes');
  mkdirSync(customDir, { recursive: true });
  const tsPath = join(customDir, `${opts.name}.ts`);
  const htmlPath = join(customDir, `${opts.name}.html`);
  if (existsSync(tsPath) || existsSync(htmlPath)) {
    throw new Error(`generator: a custom node named "${opts.name}" already exists`);
  }
  writeFileSync(tsPath, opts.tsSource, 'utf-8');
  writeFileSync(htmlPath, opts.htmlSource, 'utf-8');
  return { tsPath, htmlPath };
}
