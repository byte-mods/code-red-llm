/**
 * Tests for the schema compatibility engine.
 *
 * Naming: test_compat_<scenario>_<expected_behavior>
 */
import { describe, expect, it } from 'vitest';
import { areTypesCompatible, checkSchemaCompat } from '../../src/server/schemas/compat.js';

describe('areTypesCompatible', () => {
  it('test_compat_exact_match_returns_true', () => {
    expect(areTypesCompatible('string', 'string')).toBe(true);
    expect(areTypesCompatible('number', 'number')).toBe(true);
    expect(areTypesCompatible('boolean', 'boolean')).toBe(true);
  });

  it('test_compat_any_target_accept_everything', () => {
    expect(areTypesCompatible('string', 'any')).toBe(true);
    expect(areTypesCompatible('object', 'any')).toBe(true);
    expect(areTypesCompatible('null', 'any')).toBe(true);
  });

  it('test_compat_any_source_accept_everything', () => {
    expect(areTypesCompatible('any', 'string')).toBe(true);
    expect(areTypesCompatible('any', 'number')).toBe(true);
  });

  it('test_compat_mismatch_returns_false', () => {
    expect(areTypesCompatible('string', 'number')).toBe(false);
    expect(areTypesCompatible('boolean', 'object')).toBe(false);
    expect(areTypesCompatible('array', 'string')).toBe(false);
  });
});

describe('checkSchemaCompat', () => {
  it('test_compat_identical_schemas_return_empty', () => {
    const s = { a: 'string', b: 'number' };
    expect(checkSchemaCompat(s, s)).toHaveLength(0);
  });

  it('test_compat_source_superset_of_target_is_ok', () => {
    const source = { a: 'string', b: 'number', c: 'boolean' };
    const target = { a: 'string', b: 'number' };
    expect(checkSchemaCompat(source, target)).toHaveLength(0);
  });

  it('test_compat_missing_required_field_fails', () => {
    const source = { a: 'string' };
    const target = { a: 'string', b: 'number' };
    const err = checkSchemaCompat(source, target);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain('missing required field "b"');
  });

  it('test_compat_optional_field_may_be_absent', () => {
    const source = { a: 'string' };
    const target = { a: 'string', 'b?': 'number' };
    expect(checkSchemaCompat(source, target)).toHaveLength(0);
  });

  it('test_compat_type_mismatch_is_reported', () => {
    const source = { a: 'string' };
    const target = { a: 'number' };
    const err = checkSchemaCompat(source, target);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain('field "a": expected number, source provides string');
  });

  it('test_compat_any_target_allows_any_source', () => {
    const source = { a: 'string' };
    const target = { a: 'any' };
    expect(checkSchemaCompat(source, target)).toHaveLength(0);
  });

  it('test_compat_any_source_allows_any_target', () => {
    const source = { a: 'any' };
    const target = { a: 'number' };
    expect(checkSchemaCompat(source, target)).toHaveLength(0);
  });

  it('test_compat_multiple_errors_are_aggregated', () => {
    const source = { a: 'string', b: 'boolean' };
    const target = { a: 'number', b: 'boolean', c: 'object' };
    const err = checkSchemaCompat(source, target);
    expect(err).toHaveLength(2);
    expect(err.some((e) => e.includes('field "a"'))).toBe(true);
    expect(err.some((e) => e.includes('missing required field "c"'))).toBe(true);
  });
});
