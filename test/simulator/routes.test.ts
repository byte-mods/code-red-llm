/**
 * Tests for POST /no-code-red/simulate
 */
import { describe, expect, it } from 'vitest';

import { handleSimulate } from '../../src/server/simulator/routes.js';

function mockRes(): { statusCode: number; jsonBody: unknown; json(v: unknown): void; status(n: number): void } {
  return {
    statusCode: 200,
    jsonBody: null,
    json(v: unknown) { this.jsonBody = v; },
    status(n: number) { this.statusCode = n; return this; },
  };
}

function mockReq(body?: unknown): { body?: unknown } {
  return { body };
}

describe('handleSimulate', () => {
  it('test_simulateRoute_returns_ok_for_valid_flow', async () => {
    const res = mockRes();
    await handleSimulate(
      mockReq({ nodes: [{ id: 'a', type: 'inject', wires: [] }], startNodeId: 'a', msg: { payload: 1 } }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { ok: boolean; trace: Array<{ nodeId: string }> };
    expect(body.ok).toBe(true);
    expect(body.trace[0]!.nodeId).toBe('a');
  });

  it('test_simulateRoute_returns_400_when_nodes_missing', async () => {
    const res = mockRes();
    await handleSimulate(mockReq({ startNodeId: 'a' }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('test_simulateRoute_returns_400_when_startNodeId_missing', async () => {
    const res = mockRes();
    await handleSimulate(mockReq({ nodes: [] }) as never, res as never);
    expect(res.statusCode).toBe(400);
  });
});
