/**
 * Schema registry — SQLite-backed persistence for typed tuple definitions.
 *
 * Each schema is a named, versioned (by updatedAt) JSON object that maps
 * field names to type tags. The registry is the ground truth for the
 * wire-type validator (T3) and the LLM schema inference path (T2).
 *
 * Why SQLite instead of JSONL (like session history):
 *  - Schemas are small (KBs), random-access, and updated in place.
 *  - JSONL append-only would require full compaction on update.
 *  - better-sqlite3 is already a project dependency (sqlite node).
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

export interface SchemaRecord {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate that `definition` is a JSON object whose values are all strings
 * (type tags). Returns an empty array on success, or a list of human-readable
 * defects on failure. Never throws.
 */
export function validateSchemaDefinition(raw: string): string[] {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    errors.push(`definition is not valid JSON — ${e instanceof Error ? e.message : String(e)}`);
    return errors;
  }
  if (!isPlainObject(parsed)) {
    errors.push('definition must be a JSON object');
    return errors;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      errors.push(`definition.${key} must be a type tag string`);
    }
  }
  return errors;
}

export class SchemaValidationError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`schema validation failed: ${errors.join('; ')}`);
    this.name = 'SchemaValidationError';
  }
}

interface Row {
  id: string;
  name: string;
  definition: string;
  created_at: string;
  updated_at: string;
}

function isRow(v: unknown): v is Row {
  if (!isPlainObject(v)) return false;
  return (
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['definition'] === 'string' &&
    typeof v['created_at'] === 'string' &&
    typeof v['updated_at'] === 'string'
  );
}

function rowToRecord(row: Row): SchemaRecord {
  return {
    id: row.id,
    name: row.name,
    definition: row.definition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SchemaRegistry {
  private db: DB;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schemas (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        definition TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  /** Insert a new schema after validating its definition. Throws on bad shape or duplicate name. */
  create(name: string, definition: string): SchemaRecord {
    const errors = validateSchemaDefinition(definition);
    if (errors.length > 0) {
      throw new SchemaValidationError(errors);
    }
    const id = randomUUID();
    const ts = nowIso();
    const stmt = this.db.prepare(
      'INSERT INTO schemas (id, name, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(id, name, definition, ts, ts);
    return { id, name, definition, createdAt: ts, updatedAt: ts };
  }

  /** Fetch a schema by primary id. */
  get(id: string): SchemaRecord | undefined {
    const row = this.db.prepare('SELECT * FROM schemas WHERE id = ?').get(id);
    return isRow(row) ? rowToRecord(row) : undefined;
  }

  /** Fetch a schema by its unique name. */
  getByName(name: string): SchemaRecord | undefined {
    const row = this.db.prepare('SELECT * FROM schemas WHERE name = ?').get(name);
    return isRow(row) ? rowToRecord(row) : undefined;
  }

  /** Return all schemas, newest first. */
  list(): SchemaRecord[] {
    const rows = this.db.prepare('SELECT * FROM schemas ORDER BY created_at DESC').all();
    const out: SchemaRecord[] = [];
    for (const row of rows) {
      if (isRow(row)) out.push(rowToRecord(row));
    }
    return out;
  }

  /** Apply a partial patch (name and/or definition) and bump updatedAt. */
  update(id: string, patch: { name?: string; definition?: string }): SchemaRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    if (patch.definition !== undefined) {
      const errors = validateSchemaDefinition(patch.definition);
      if (errors.length > 0) {
        throw new SchemaValidationError(errors);
      }
    }
    const newName = patch.name ?? existing.name;
    const newDef = patch.definition ?? existing.definition;
    const ts = nowIso();
    this.db.prepare('UPDATE schemas SET name = ?, definition = ?, updated_at = ? WHERE id = ?').run(
      newName,
      newDef,
      ts,
      id,
    );
    return { id, name: newName, definition: newDef, createdAt: existing.createdAt, updatedAt: ts };
  }

  /** Remove a schema by id. Returns true if a row was deleted. */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM schemas WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Release the SQLite connection. Idempotent. */
  close(): void {
    this.db.close();
  }
}
