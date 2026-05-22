/**
 * Express handlers for the schema registry REST API.
 *
 * All routes are mounted under `/no-code-red/schemas` by plugin.ts.
 * Errors are translated to status codes:
 *   400 — bad request (missing fields or invalid definition)
 *   404 — schema not found
 *   409 — duplicate name (SQLite UNIQUE constraint)
 */
import type { Request, Response } from '../types.js';
import { SchemaRegistry, SchemaValidationError } from './registry.js';

export function makeSchemaHandlers(registry: SchemaRegistry) {
  return {
    handleListSchemas(_req: Request, res: Response) {
      res.json({ schemas: registry.list() });
    },

    handleGetSchema(req: Request, res: Response) {
      const id = paramId(req);
      if (id === undefined) {
        res.status(400).json({ error: 'invalid id parameter' });
        return;
      }
      const record = registry.get(id);
      if (!record) {
        res.status(404).json({ error: 'schema not found' });
        return;
      }
      res.json(record);
    },

    handleCreateSchema(req: Request, res: Response) {
      const body = req.body;
      if (!isObj(body)) {
        res.status(400).json({ error: 'body must be a JSON object' });
        return;
      }
      const name = takeString(body, 'name');
      const definition = takeString(body, 'definition');
      if (name === undefined) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      if (definition === undefined) {
        res.status(400).json({ error: 'definition is required' });
        return;
      }
      try {
        const record = registry.create(name, definition);
        res.status(201).json(record);
      } catch (e) {
        if (e instanceof SchemaValidationError) {
          res.status(400).json({ error: 'validation failed', details: e.errors });
          return;
        }
        if (isSqliteUniqueError(e)) {
          res.status(409).json({ error: `schema name "${name}" already exists` });
          return;
        }
        throw e;
      }
    },

    handleUpdateSchema(req: Request, res: Response) {
      const id = paramId(req);
      if (id === undefined) {
        res.status(400).json({ error: 'invalid id parameter' });
        return;
      }
      const body = req.body;
      if (!isObj(body)) {
        res.status(400).json({ error: 'body must be a JSON object' });
        return;
      }
      const patch: { name?: string; definition?: string } = {};
      if ('name' in body) {
        const name = takeString(body, 'name');
        if (name === undefined) {
          res.status(400).json({ error: 'name must be a string when present' });
          return;
        }
        patch.name = name;
      }
      if ('definition' in body) {
        const definition = takeString(body, 'definition');
        if (definition === undefined) {
          res.status(400).json({ error: 'definition must be a string when present' });
          return;
        }
        patch.definition = definition;
      }
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ error: 'no fields to update' });
        return;
      }
      try {
        const record = registry.update(id, patch);
        if (!record) {
          res.status(404).json({ error: 'schema not found' });
          return;
        }
        res.json(record);
      } catch (e) {
        if (e instanceof SchemaValidationError) {
          res.status(400).json({ error: 'validation failed', details: e.errors });
          return;
        }
        if (isSqliteUniqueError(e)) {
          res.status(409).json({ error: `schema name "${patch.name}" already exists` });
          return;
        }
        throw e;
      }
    },

    handleDeleteSchema(req: Request, res: Response) {
      const id = paramId(req);
      if (id === undefined) {
        res.status(400).json({ error: 'invalid id parameter' });
        return;
      }
      const deleted = registry.delete(id);
      if (!deleted) {
        res.status(404).json({ error: 'schema not found' });
        return;
      }
      res.status(204).end();
    },
  };
}

function paramId(req: Request): string | undefined {
  const v = req.params.id;
  if (typeof v !== 'string') return undefined;
  return v;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function takeString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return undefined;
  return v;
}

function isSqliteUniqueError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
  return Reflect.get(e, 'code') === 'SQLITE_CONSTRAINT_UNIQUE';
}
