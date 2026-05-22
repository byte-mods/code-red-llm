# no_code_red

A Node-RED plugin that turns natural-language prompts into live, animated flows on the editor canvas — powered by a `claude` CLI subprocess.

> **Status:** Section 4 (Smart Canvas) complete. See `current-tasks.md` for the live work ledger.

## Sections shipped

- **S1 — Foundations.** TypeScript monorepo, Vitest, Node-RED 4 plugin skeleton, `GET /no-code-red/health`, multi-stage Dockerfile, GitHub Actions CI, dev + prod launchers with graceful SIGTERM shutdown.
- **S2 — Claude subprocess bridge.** Typed `spawnClaude` returning `AsyncIterable<ClaudeEvent>` + `done: Promise<ClaudeExit>` lifecycle. Discriminated-union event model (`system`/`assistant`/`user`/`stream_event`/`result` + forward-compat). Cooperative `cancel()`, hard `timeoutMs`, `AbortSignal` wiring with SIGTERM→SIGKILL escalation. Fake-binary replay harness so tests never call the real CLI. See `src/server/claude/`.
- **S3 — Prompt protocol + incremental extractor.** `buildPrompt` instructs Claude to emit Node-RED nodes as `<NODE>{...}</NODE>` blocks inside text content. Hand-rolled `validateNode` narrows raw JSON to `NodeRedNode` (id, type, x, y, wires required; name, z optional; extras pass through) and aggregates every defect. `extractNodes` async generator consumes `AsyncIterable<ClaudeEvent>` from the bridge, buffers across events (including mid-sentinel splits), yields one `NodeExtractionResult` per block with four typed error reasons (malformed-json, not-an-object, validation-failed, runaway-sentinel). See `src/server/prompt/` and `src/server/extractor/`.
- **S4 — SSE streaming server + Smart Canvas.** `GET /no-code-red/generate?prompt=...&flowId=...&model=...` ties the bridge + extractor into an Express handler that streams `meta` → `node` → `error` → `done` frames. Client disconnect → `session.cancel('user')`. 15s heartbeat. New: server-side flow validator (`src/server/flow/validator.ts`), client auto-layout engine (`layoutNodes` in sidebar), and chat staging/diff panel so refinements are reviewed before applying. `POST /no-code-red/validate` exposes the validator to the client. See `src/server/sse/` and `src/server/flow/`.
- **S5 — Sidebar UI.** Prompt textarea + Generate/Cancel + EventSource client + live `RED.nodes.add` calls. Nodes appear on the canvas as Claude emits them. See `src/client/sidebar.html`.
- **S6 — Persistence + multi-session.** In-memory `GenerationRegistry` with bounded concurrency (4) and cancel-by-id. Append-only JSONL history per generation under `.no-code-red/history/YYYY-MM-DD/<id>.jsonl`. Admin routes: `GET /no-code-red/generations` (list) + `POST /no-code-red/generations/:id/cancel` (cancel). See `src/server/session/`.
- **S7 — Production hardening.** Graceful shutdown (RED.stop → cancel all active generations). Input limits: 8KB prompt cap (413), 2s per-IP rate limit (429), 4-concurrent cap (503). Multi-arch Docker via `buildx` (see below). Playwright e2e is deferred — left as a follow-up because it introduces a browser-binary dependency tree and CI runner changes that warrant their own session.

- **S8 — Connectors + LLM node.** 11 new palette nodes shipped: `postgres`, `mariadb`, `oraclesql`, `mongodb`, `cassandra`, `scylladb`, `clickhouse`, `redis`, `kafka-producer`, `kafka-consumer`, `llm`. Each is demo-grade (single pool / client per deployed node, basic error → red status mapping, clean disconnect on flow stop). Prompt template extended so Claude knows all these node types exist and emits flows using them by name. See `src/server/nodes/`.

**184 tests pass across 17 test files. 30+ connector nodes registered with the editor palette.**

### Driver runtime notes (S8)

- **oraclesql** requires Oracle Instant Client installed on the host — the npm `oracledb` package installs without it, but the first connection throws `DPI-1047` until the OCI libs are present.
- **kafkajs** does not need a separate native build — it's pure JS — but production deployments should configure SASL/SSL via additional `Kafka` constructor options not surfaced by the demo node.
- **llm** reads `ANTHROPIC_API_KEY` from the environment if the per-node `apiKey` field is empty.

## What it does

1. You open Node-RED, click the **no_code_red** sidebar tab, and type a prompt: _"build a flow that polls an HTTP API every 30s and posts results to Slack."_
2. The plugin spawns `claude -p ... --output-format stream-json` and streams the response.
3. As Claude emits each Node-RED node JSON, the sidebar receives it over Server-Sent Events and the canvas animates it into place — wired and ready to deploy.

## Architecture (target)

```
Sidebar (browser, vanilla JS)
   │  EventSource → /no_code_red/generate?id=...
   ▼
Express route (Node-RED admin app)
   │  spawn('claude', ['-p', prompt, '--output-format', 'stream-json'])
   ▼
Stream parser (line-delimited JSON)
   │  emits structured "node-emitted" events
   ▼
SSE writer ── back to sidebar ── RED.nodes.add() ── animated draw
```

## Requirements

- Node.js ≥ 20, < 27 (see `.nvmrc`)
- `claude` CLI on `$PATH` (authenticated)
- Docker (for the dev container — Section 7)

## Layout

```
src/
  server/    # plugin entry, Claude subprocess bridge, SSE server
  client/    # sidebar UI (vanilla JS, loaded by Node-RED editor)
test/        # vitest unit + integration tests
scripts/     # dev/build helpers
```

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run
npm run dev         # build + launch local Node-RED at http://localhost:1880
```

Probe the plugin:

```bash
curl http://localhost:1880/no-code-red/health
# → {"ok":true,"plugin":"no-code-red","version":"0.1.0"}
```

## Run with Docker

```bash
docker compose up --build
open http://localhost:1880/
```

Flow state persists in the `nodered-data` named volume. The `claude` CLI is
not baked into the image — derive your own image and add it via your account-
specific install command before exercising the prompt-to-flow path.

### Multi-arch images (S7)

The base image (`node:20-bookworm-slim`) is multi-arch — building for both
`linux/amd64` and `linux/arm64` requires only `docker buildx`:

```bash
docker buildx create --name no-code-red-builder --use   # one-time
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag your-registry/no-code-red:0.1.0 \
  --push .
```

The image runs as a non-root `nodered` user, includes `tini` for PID-1
zombie reaping, and ships a `HEALTHCHECK` that probes `/no-code-red/health`
every 15s.

## CI

GitHub Actions runs `lint → typecheck → test → build → boot smoke` on every
push and PR. See `.github/workflows/ci.yml`.

## License

MIT.
