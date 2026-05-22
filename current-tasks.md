# Current Tasks

_Single source of truth for in-flight work. Updated by the agent before starting and after completing every task. Read this first to see what is in progress, what is queued, and what is done._

## In progress

(none)

## Queued

(none)

## Completed (this session)

- [§14] Feed Simulation — `feed-sim` node generates synthetic events from a schema with configurable interval/count — completed 2026-05-22T23:53:00+05:30 — 3 new tests, 295 total tests, typecheck clean
- [§12] Security — API-key auth middleware (`X-API-Key` header) for all `/no-code-red/*` admin routes except `/health` — completed 2026-05-22T23:20:00+05:30 — 2 new tests, typecheck clean
- [§10] LiveView — `liveview` node materializes streams into queryable in-memory tables + REST API (`GET /liveview`, `GET /liveview/:name`) — completed 2026-05-22T23:42:00+05:30 — 7 new tests (4 node + 3 route), typecheck clean
- [§8] Query Tables — `query-table` node (CRUD in-memory tables) + `table-join` node (stream enrichment by key) — completed 2026-05-22T23:32:00+05:30 — 12 new tests (9 query-table + 3 table-join), typecheck clean
- [T5] API handler tests + plugin route assertions for schema registry — completed 2026-05-22T23:00:00+05:30 — 27 new tests (18 handler + 1 plugin route), 273 total tests, typecheck clean — **Section 9 (Schema-First Flow System) CLOSED**
- [T4] Template auto-schema — instruct Claude to insert `schema` nodes between producer/consumer pairs automatically — completed 2026-05-22T22:56:00+05:30 — 2 new prompt tests, 254 total tests, typecheck clean
- [T3] Wire-type validator — validate upstream output schema matches downstream input schema before canvas add — completed 2026-05-22T22:52:00+05:30 — 28 new tests (12 compat + 16 wiretypes/routes), 252 total tests, typecheck clean
- [T2] LLM schema inference — extend `buildPrompt` + `extractNodes` to emit and parse `<SCHEMA>{...}</SCHEMA>` blocks — completed 2026-05-22T21:54:00+05:30 — 9 new tests (7 extractor + 2 prompt), 224 total tests, typecheck clean
- [T1] Schema registry API — SQLite-backed CRUD for schemas under `/no-code-red/schemas` — completed 2026-05-22T21:25:00+05:30 — 18 tests pass, typecheck clean, super-qa PASS with 4 MINOR logged for follow-up
- [T3] Simulation UI panel — sidebar test runner + trace viewer (no new tests — client HTML verified by build + existing suite)
- [T1] Simulation engine + registry — core dry-run loop + node-type simulators (10 tests)
- [T2] Simulation API route — POST /no-code-red/simulate mounted in plugin.ts (3 tests)
- Fix reload cache-bust race and registry-test type error
- [T1] Server-side flow validator
- [T2] Client-side auto-layout engine
- [T3] Validation panel + chat staging/diff
- Section 4 (Smart Canvas) closed
- Section 15 (Simulation) closed
