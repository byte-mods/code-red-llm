/**
 * Shared in-memory table registry for query-table and table-join nodes.
 *
 * Tables live for the lifetime of the Node-RED process. No persistence.
 */

export type TableMap = Map<string, Record<string, unknown>>;

const tables = new Map<string, TableMap>();

export function getTable(name: string): TableMap {
  let t = tables.get(name);
  if (t === undefined) {
    t = new Map();
    tables.set(name, t);
  }
  return t;
}

export function dropTable(name: string): boolean {
  return tables.delete(name);
}

export function listTables(): string[] {
  return [...tables.keys()];
}
