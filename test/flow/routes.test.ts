/**
 * Tests for POST /no-code-red/validate
 */
import { describe, expect, it } from 'vitest';
import { handleValidate } from '../../src/server/flow/index.js';

function mockRes(): { statusCode: number; jsonBody: unknown; json(v: unknown): void; status(n: number): void } {
  return {
    statusCode: 200,
    jsonBody: null,
    json(v: unknown) { this.jsonBody = v; },
    status(n: number) { this.statusCode = n; },
  };
}

function mockReq(body?: unknown): { body?: unknown } {
  return { body };
}

describe('handleValidate', () => {
  it('test_validateRoute_returns_ok_for_valid_nodes', () => {
    const res = mockRes();
    handleValidate(mockReq({ nodes: [{ id: 'a', type: 'inject', x: 0, y: 0, wires: [] }] }) as never, res as never);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { ok: boolean }).ok).toBe(true);
  });

  it('test_validateRoute_returns_issues_for_duplicate_ids', () => {
    const res = mockRes();
    handleValidate(mockReq({ nodes: [{ id: 'a', type: 'inject', x: 0, y: 0, wires: [] }, { id: 'a', type: 'debug', x: 0, y: 0, wires: [] }] }) as never, res as never);
    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { ok: boolean; issues: Array<{ type: string }> };
    expect(body.ok).toBe(false);
    expect(body.issues.some((i) => i.type === 'duplicate-id')).toBe(true);
  });

  it('test_validateRoute_handles_missing_body', () => {
    const res = mockRes();
    handleValidate(mockReq() as never, res as never);
    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { ok: boolean }).ok).toBe(true);
  });
});
