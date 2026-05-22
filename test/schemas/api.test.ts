/**
 * Tests for the schema registry REST API handlers.
 *
 * Strategy: use a real :memory: SchemaRegistry so we exercise validation
 * + SQLite paths, but mock Express req/res to avoid starting a server.
 *
 * Naming: test_schemaApi_<scenario>_<expected_behavior>
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SchemaRegistry } from '../../src/server/schemas/registry.js';
import { makeSchemaHandlers } from '../../src/server/schemas/api.js';
import type { Request, Response } from '../../src/server/types.js';

function mockRes(): {
  statusCode: number;
  jsonBody: unknown;
  ended: boolean;
  json(v: unknown): void;
  status(n: number): { json(v: unknown): void };
  end(): void;
} {
  const self = {
    statusCode: 200,
    jsonBody: null as unknown,
    ended: false,
    json(v: unknown) { self.jsonBody = v; return self; },
    status(n: number) { self.statusCode = n; return self; },
    end() { self.ended = true; return self; },
  };
  return self;
}

function mockReq(overrides?: {
  body?: unknown;
  params?: Record<string, string>;
}): Request {
  return {
    body: overrides?.body,
    params: overrides?.params ?? {},
  } as unknown as Request;
}

describe('schema API handlers', () => {
  let registry: SchemaRegistry;
  let handlers: ReturnType<typeof makeSchemaHandlers>;

  beforeEach(() => {
    registry = new SchemaRegistry(':memory:');
    handlers = makeSchemaHandlers(registry);
  });

  afterEach(() => {
    registry.close();
  });

  describe('handleListSchemas', () => {
    it('test_schemaApi_list_returns_empty_array_initially', () => {
      const res = mockRes();
      handlers.handleListSchemas(mockReq(), res as unknown as Response);
      expect(res.statusCode).toBe(200);
      expect(res.jsonBody).toEqual({ schemas: [] });
    });

    it('test_schemaApi_list_returns_created_schemas', () => {
      registry.create('orders', '{"id":"string"}');
      const res = mockRes();
      handlers.handleListSchemas(mockReq(), res as unknown as Response);
      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { schemas: Array<{ name: string }> };
      expect(body.schemas).toHaveLength(1);
      expect(body.schemas[0]?.name).toBe('orders');
    });
  });

  describe('handleGetSchema', () => {
    it('test_schemaApi_get_returns_schema_by_id', () => {
      const created = registry.create('orders', '{"id":"string"}');
      const res = mockRes();
      handlers.handleGetSchema(mockReq({ params: { id: created.id } }), res as unknown as Response);
      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as { name: string }).name).toBe('orders');
    });

    it('test_schemaApi_get_missing_id_returns_404', () => {
      const res = mockRes();
      handlers.handleGetSchema(mockReq({ params: { id: 'no-such-id' } }), res as unknown as Response);
      expect(res.statusCode).toBe(404);
    });

    it('test_schemaApi_get_invalid_id_returns_400', () => {
      const res = mockRes();
      handlers.handleGetSchema(mockReq({ params: {} }), res as unknown as Response);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('handleCreateSchema', () => {
    it('test_schemaApi_create_returns_201_and_record', () => {
      const res = mockRes();
      handlers.handleCreateSchema(
        mockReq({ body: { name: 'orders', definition: '{"id":"string"}' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(201);
      const body = res.jsonBody as { name: string; definition: string };
      expect(body.name).toBe('orders');
      expect(body.definition).toBe('{"id":"string"}');
    });

    it('test_schemaApi_create_missing_name_returns_400', () => {
      const res = mockRes();
      handlers.handleCreateSchema(
        mockReq({ body: { definition: '{"id":"string"}' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });

    it('test_schemaApi_create_missing_definition_returns_400', () => {
      const res = mockRes();
      handlers.handleCreateSchema(
        mockReq({ body: { name: 'orders' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });

    it('test_schemaApi_create_invalid_definition_returns_400', () => {
      const res = mockRes();
      handlers.handleCreateSchema(
        mockReq({ body: { name: 'orders', definition: 'not-json' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });

    it('test_schemaApi_create_duplicate_name_returns_409', () => {
      registry.create('orders', '{"id":"string"}');
      const res = mockRes();
      handlers.handleCreateSchema(
        mockReq({ body: { name: 'orders', definition: '{"x":"number"}' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(409);
    });
  });

  describe('handleUpdateSchema', () => {
    it('test_schemaApi_update_name_and_definition', () => {
      const created = registry.create('orders', '{"id":"string"}');
      const res = mockRes();
      handlers.handleUpdateSchema(
        mockReq({ params: { id: created.id }, body: { name: 'invoices', definition: '{"total":"number"}' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { name: string; definition: string };
      expect(body.name).toBe('invoices');
      expect(body.definition).toBe('{"total":"number"}');
    });

    it('test_schemaApi_update_missing_schema_returns_404', () => {
      const res = mockRes();
      handlers.handleUpdateSchema(
        mockReq({ params: { id: 'no-such-id' }, body: { name: 'x' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(404);
    });

    it('test_schemaApi_update_empty_body_returns_400', () => {
      const created = registry.create('orders', '{"id":"string"}');
      const res = mockRes();
      handlers.handleUpdateSchema(
        mockReq({ params: { id: created.id }, body: {} }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });

    it('test_schemaApi_update_invalid_definition_returns_400', () => {
      const created = registry.create('orders', '{"id":"string"}');
      const res = mockRes();
      handlers.handleUpdateSchema(
        mockReq({ params: { id: created.id }, body: { definition: 'bad' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });

    it('test_schemaApi_update_duplicate_name_returns_409', () => {
      registry.create('orders', '{"id":"string"}');
      const invoices = registry.create('invoices', '{"total":"number"}');
      const res = mockRes();
      handlers.handleUpdateSchema(
        mockReq({ params: { id: invoices.id }, body: { name: 'orders' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(409);
    });
  });

  describe('handleDeleteSchema', () => {
    it('test_schemaApi_delete_returns_204', () => {
      const created = registry.create('orders', '{"id":"string"}');
      const res = mockRes();
      handlers.handleDeleteSchema(
        mockReq({ params: { id: created.id } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(204);
      expect(res.ended).toBe(true);
    });

    it('test_schemaApi_delete_missing_returns_404', () => {
      const res = mockRes();
      handlers.handleDeleteSchema(
        mockReq({ params: { id: 'no-such-id' } }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(404);
    });

    it('test_schemaApi_delete_invalid_id_returns_400', () => {
      const res = mockRes();
      handlers.handleDeleteSchema(
        mockReq({ params: {} }),
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });
  });
});
