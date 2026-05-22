#!/usr/bin/env node
/**
 * Test double for the `claude` CLI.
 *
 * Reads a fixture file (line-delimited JSON) and replays it to stdout with a
 * configurable inter-line delay. Exits with a configurable code. Used by
 * `test/claude/spawn.test.ts` so the subprocess bridge can be exercised
 * without invoking the real CLI (which costs money and needs auth).
 *
 * Argv:
 *   node fake-claude.mjs <fixture-path> [--exit-code N] [--delay-ms N]
 *                       [--echo-argv]      Echo argv to stderr for argv asserts.
 *                       [--malform-after N] Replace line N (0-indexed) with garbage.
 *                       [--hang-forever]  Print first line then sleep indefinitely.
 *
 * Stdin is read and discarded so the bridge can pass a prompt via stdin
 * without back-pressuring the writer (mirrors real CLI behavior).
 */
import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdin, stdout } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const args = argv.slice(2);
if (args.length === 0) {
  stderr.write('fake-claude: missing fixture path\n');
  exit(2);
}

const fixturePath = args[0];
let exitCode = 0;
let delayMs = 0;
let echoArgv = false;
let malformAfter = -1;
let hangForever = false;

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === '--exit-code') exitCode = Number(args[++i]);
  else if (a === '--delay-ms') delayMs = Number(args[++i]);
  else if (a === '--echo-argv') echoArgv = true;
  else if (a === '--malform-after') malformAfter = Number(args[++i]);
  else if (a === '--hang-forever') hangForever = true;
}

if (echoArgv) {
  stderr.write(`ARGV=${JSON.stringify(argv)}\n`);
}

// Drain stdin so the parent's writes don't back-pressure.
stdin.on('data', () => {});
stdin.on('error', () => {});

const raw = readFileSync(fixturePath, 'utf-8');
const lines = raw.split('\n').filter((l) => l !== '');

for (let i = 0; i < lines.length; i++) {
  if (i === malformAfter) {
    stdout.write('{not valid json\n');
    continue;
  }
  stdout.write(lines[i] + '\n');
  if (hangForever && i === 0) {
    // Keep stdout open and never exit.
    await new Promise(() => {});
  }
  if (delayMs > 0) await sleep(delayMs);
}

exit(exitCode);
