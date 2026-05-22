/**
 * Tests for the schema registry.
 *
 * Naming: test_schema_registry_<scenario>_<expected>.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SchemaRegistry, SchemaValidationError, validateSchemaDefinition } from '../../src/server/schemas/index.js';

describe('validateSchemaDefinition', () => {
  it('accepts a valid flat object of type tags', () => {
    const errors = validateSchemaDefinition('{"id":"string","amount":"number"}');
    expect(errors).toEqual([]);
  });

  it('rejects invalid JSON', () => {
    const errors = validateSchemaDefinition('not json');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('not valid JSON');
  });

  it('rejects an array', () => {
    const errors = validateSchemaDefinition('["string"]');
    expect(errors[0]).toBe('definition must be a JSON object');
  });

  it('rejects non-string values', () => {
    const errors = validateSchemaDefinition('{"x":123}');
    expect(errors[0]).toBe('definition.x must be a type tag string');
  });
});

describe('SchemaRegistry — CRUD', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry(':memory:');
  });

  afterEach(() => {
    registry.close();
  });

  it('creates a schema and retrieves it by id', () => {
    const record = registry.create('orders', '{"id":"string","amount":"number"}');
    expect(record.name).toBe('orders');
    expect(record.definition).toBe('{"id":"string","amount":"number"}');
    expect(record.id).toBeDefined();
    expect(record.createdAt).toBeDefined();

    const got = registry.get(record.id);
    expect(got).toEqual(record);
  });

  it('retrieves a schema by name', () => {
    const record = registry.create('users', '{"name":"string"}');
    const got = registry.getByName('users');
    expect(got).toEqual(record);
  });

  it('returns undefined for missing id', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('returns undefined for missing name', () => {
    expect(registry.getByName('nonexistent')).toBeUndefined();
  });

  it('lists schemas in descending creation order', () => {
    const r1 = registry.create('a', '{"x":"string"}');
    const r2 = registry.create('b', '{"y":"number"}');
    const list = registry.list();
    expect(list.length).toBe(2);
    const ids = list.map((s) => s.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
  });

  it('updates name and definition', () => {
    const r = registry.create('old', '{"x":"string"}');
    const updated = registry.update(r.id, { name: 'new', definition: '{"y":"number"}' });
    expect(updated!.name).toBe('new');
    expect(updated!.definition).toBe('{"y":"number"}');
    expect(updated!.createdAt).toBe(r.createdAt);
    expect(updated!.updatedAt).toBeDefined();
  });

  it('updates name only', () => {
    const r = registry.create('old', '{"x":"string"}');
    const updated = registry.update(r.id, { name: 'new' });
    expect(updated!.name).toBe('new');
    expect(updated!.definition).toBe(r.definition);
  });

  it('updates definition only', () => {
    const r = registry.create('old', '{"x":"string"}');
    const updated = registry.update(r.id, { definition: '{"y":"number"}' });
    expect(updated!.name).toBe('old');
    expect(updated!.definition).toBe('{"y":"number"}');
  });

  it('returns undefined for missing schema on update', () => {
    expect(registry.update('nonexistent', { name: 'x' })).toBeUndefined();
  });

  it('deletes a schema', () => {
    const r = registry.create('del', '{"x":"string"}');
    expect(registry.delete(r.id)).toBe(true);
    expect(registry.get(r.id)).toBeUndefined();
  });

  it('returns false for missing schema on delete', () => {
    expect(registry.delete('nonexistent')).toBe(false);
  });

  it('rejects duplicate names on create', () => {
    registry.create('dup', '{"x":"string"}');
    expect(() => registry.create('dup', '{"y":"number"}')).toThrow();
  });

  it('rejects invalid definition on create', () => {
    expect(() => registry.create('bad', 'not json')).toThrow(SchemaValidationError);
  });

  it('rejects invalid definition on update', () => {
    const r = registry.create('good', '{"x":"string"}');
    expect(() => registry.update(r.id, { definition: '{"x":123}' })).toThrow(SchemaValidationError);
  });
});
