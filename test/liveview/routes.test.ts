/**
 * Tests for the LiveView REST API.
 *
 * Naming: test_liveviewRoute_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import { handleListLiveViews, handleGetLiveView } from '../../src/server/liveview/routes.js';

function mockRes(): {
  statusCode: number;
  jsonBody: unknown;
  status(n: number): typeof self;
  json(v: unknown): typeof self;
} {
  const self = {
    statusCode: 200,
    jsonBody: null as unknown,
    status(n: number) { self.statusCode = n; return self; },
    json(v: unknown) { self.jsonBody = v; return self; },
  };
  return self;
}

function mockReq(params?: Record<string, string>): { params: Record<string, string> } {
  return { params: params ?? {} };
}

describe('handleListLiveViews', () => {
  it('test_liveviewRoute_list_returns_views_array', () => {
    const res = mockRes();
    handleListLiveViews(mockReq() as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.jsonBody as { views: string[] }).views)).toBe(true);
  });
});

describe('handleGetLiveView', () => {
  it('test_liveviewRoute_get_returns_snapshot', () => {
    const res = mockRes();
    handleGetLiveView(mockReq({ name: 'orders' }) as never, res as never);
    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { view: string; count: number; rows: unknown[] };
    expect(body.view).toBe('orders');
    expect(typeof body.count).toBe('number');
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('test_liveviewRoute_get_missing_name_returns_400', () => {
    const res = mockRes();
    handleGetLiveView(mockReq() as never, res as never);
    expect(res.statusCode).toBe(400);
  });
});
