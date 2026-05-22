/**
 * Unit tests for the Node-RED plugin entry.
 *
 * Strategy: we never launch Node-RED in unit tests — too heavy and ties our
 * inner loop to a full runtime. Instead we hand-build a `RED` double that
 * captures registrations and route handlers, invoke the plugin factory with
 * it, and assert against the captured state.
 *
 * Integration coverage (actually starting Node-RED, hitting /health with
 * curl) lives in section 7 alongside Playwright e2e.
 *
 * Naming: test_<component>_<scenario>_<expected_behavior>.
 */
import { describe, expect, it, vi } from 'vitest';
import plugin, { PLUGIN_ID, ADMIN_PREFIX, HEALTH_PAYLOAD } from '../src/server/plugin.js';
import type { RED } from '../src/server/types.js';

/**
 * Build a minimal RED double. Routes are stored in a map keyed by
 * `${METHOD} ${path}` so tests can fetch the handler by name. The Express
 * surface is intentionally tiny — only what our plugin touches.
 */
function makeRedDouble(): {
  red: RED;
  routes: Map<string, (req: unknown, res: unknown) => void>;
  registered: Array<{ id: string; type: string }>;
  logs: { info: string[]; warn: string[]; error: string[] };
} {
  const routes = new Map<string, (req: unknown, res: unknown) => void>();
  const registered: Array<{ id: string; type: string }> = [];
  const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };

  const red = {
    log: {
      info: (m: unknown) => logs.info.push(String(m)),
      warn: (m: unknown) => logs.warn.push(String(m)),
      error: (m: unknown) => logs.error.push(String(m)),
      debug: () => {},
      trace: () => {},
    },
    plugins: {
      registerPlugin: (id: string, desc: { type: string }) => {
        registered.push({ id, type: desc.type });
      },
    },
    httpAdmin: {
      get: (path: string, handler: (req: unknown, res: unknown) => void) => {
        routes.set(`GET ${path}`, handler);
      },
      post: (path: string, handler: (req: unknown, res: unknown) => void) => {
        routes.set(`POST ${path}`, handler);
      },
      put: (path: string, handler: (req: unknown, res: unknown) => void) => {
        routes.set(`PUT ${path}`, handler);
      },
      delete: (path: string, handler: (req: unknown, res: unknown) => void) => {
        routes.set(`DELETE ${path}`, handler);
      },
    },
    settings: {},
  } as unknown as RED;

  return { red, routes, registered, logs };
}

describe('plugin — registration', () => {
  it('test_plugin_registers_under_canonical_id', () => {
    const { red, registered } = makeRedDouble();
    plugin(red);
    expect(registered).toHaveLength(1);
    expect(registered[0]).toEqual({ id: PLUGIN_ID, type: 'node-red-plugin' });
  });

  it('test_plugin_logs_load_banner_on_init', () => {
    const { red, logs } = makeRedDouble();
    plugin(red);
    expect(logs.info.some((m) => m.includes(PLUGIN_ID))).toBe(true);
    expect(logs.error).toHaveLength(0);
  });
});

describe('plugin — admin routes', () => {
  it('test_health_route_mounted_under_admin_prefix', () => {
    const { red, routes } = makeRedDouble();
    plugin(red);
    expect(routes.has(`GET ${ADMIN_PREFIX}/health`)).toBe(true);
  });

  it('test_health_handler_returns_static_payload', () => {
    const { red, routes } = makeRedDouble();
    plugin(red);
    const handler = routes.get(`GET ${ADMIN_PREFIX}/health`);
    expect(handler).toBeDefined();

    const json = vi.fn();
    const req = {};
    const res = { json };
    handler!(req, res);

    expect(json).toHaveBeenCalledExactlyOnceWith(HEALTH_PAYLOAD);
    expect(HEALTH_PAYLOAD.ok).toBe(true);
    expect(HEALTH_PAYLOAD.plugin).toBe(PLUGIN_ID);
  });

  it('test_health_payload_is_frozen_to_prevent_mutation', () => {
    expect(Object.isFrozen(HEALTH_PAYLOAD)).toBe(true);
  });

  it('test_generate_route_mounted_under_admin_prefix', () => {
    // S4.T3: the SSE generation endpoint must be discoverable on the
    // admin app under the canonical /no-code-red prefix. Behaviour is
    // covered by writer.test.ts + the integration test that pipes a
    // fake-claude transcript through the route.
    const { red, routes } = makeRedDouble();
    plugin(red);
    expect(routes.has(`GET ${ADMIN_PREFIX}/generate`)).toBe(true);
  });

  it('test_session_admin_routes_mounted', () => {
    // S6.T3: list + cancel-by-id routes for the in-memory registry.
    const { red, routes } = makeRedDouble();
    plugin(red);
    expect(routes.has(`GET ${ADMIN_PREFIX}/generations`)).toBe(true);
    expect(routes.has(`POST ${ADMIN_PREFIX}/generations/:id/cancel`)).toBe(true);
  });

  it('test_schema_registry_routes_mounted', () => {
    const { red, routes } = makeRedDouble();
    plugin(red);
    expect(routes.has(`GET ${ADMIN_PREFIX}/schemas`)).toBe(true);
    expect(routes.has(`GET ${ADMIN_PREFIX}/schemas/:id`)).toBe(true);
    expect(routes.has(`POST ${ADMIN_PREFIX}/schemas`)).toBe(true);
    expect(routes.has(`PUT ${ADMIN_PREFIX}/schemas/:id`)).toBe(true);
    expect(routes.has(`DELETE ${ADMIN_PREFIX}/schemas/:id`)).toBe(true);
  });

  it('test_liveview_routes_mounted', () => {
    const { red, routes } = makeRedDouble();
    plugin(red);
    expect(routes.has(`GET ${ADMIN_PREFIX}/liveview`)).toBe(true);
    expect(routes.has(`GET ${ADMIN_PREFIX}/liveview/:name`)).toBe(true);
  });

  it('test_plugin_registers_onremove_hook_for_graceful_shutdown', () => {
    // S7.T1: when Node-RED stops, the plugin must cancel every active
    // generation so no claude subprocesses are orphaned past host exit.
    // The plugin double captures the descriptor and exposes it here.
    const { red, registered: _r } = makeRedDouble();
    // The double's makeRedDouble does not currently expose the
    // descriptor — extend it inline.
    let captured: { type: string; onremove?: () => void } | null = null;
    const localRed = {
      ...red,
      plugins: {
        registerPlugin: (_id: string, desc: { type: string; onremove?: () => void }) => {
          captured = desc;
        },
      },
    } as unknown as Parameters<typeof plugin>[0];
    plugin(localRed);
    expect(captured).not.toBeNull();
    expect(typeof captured!.onremove).toBe('function');
    // Calling it should be safe even with no active generations.
    expect(() => captured!.onremove!()).not.toThrow();
  });
});
