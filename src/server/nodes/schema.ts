/**
 * Node-RED node: schema
 *
 * Schema-aware wire enforcement — StreamBase's strongly-typed tuple
 * concept retrofitted onto Node-RED's bag-of-keys messages. Place
 * between source and sink in any pipeline where downstream nodes need a
 * stable contract on `msg.payload` (or any other msg field).
 *
 * Definition shape (compact, hand-rolled — no JSON Schema dep):
 *   { "<fieldName>": "<typeSpec>", … }
 *
 * typeSpec is one of:
 *   string | number | integer | boolean | object | array | null | any
 *   plus an optional trailing "?" to mark a field as optional, e.g. "name?".
 *
 * Example:
 *   {
 *     "orderId": "string",
 *     "amount":  "number",
 *     "items":   "array",
 *     "memo?":   "string"
 *   }
 *
 * Config:
 *   definition  JSON string of the field → type map above
 *   target      msg field path to validate (default "payload")
 *   strict      true → reject extra fields, false (default) → ignore them
 *
 * Outputs (the .html declares outputs: 2 so Node-RED routes correctly):
 *   port 0 (valid)   — original msg, unchanged
 *   port 1 (invalid) — original msg + `msg.errors: string[]`
 *
 * Demo-grade: validation is per-message; no schema compilation cache.
 * For very hot paths, precompile the spec into a validator function.
 */
import type { NodeInstance, NodeMessage, NodeModule } from './red-runtime.js';
import { cfgBoolean, cfgString } from './helpers.js';

const NODE_TYPE = 'schema';

/** Allowed leaf types. `any` skips type-checking for that field. */
const ALLOWED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null', 'any']);

interface FieldSpec {
  /** Stripped field name (no trailing `?`). */
  readonly name: string;
  /** Expected type tag from ALLOWED_TYPES. */
  readonly type: string;
  /** True if `?` was present, meaning the field may be absent. */
  readonly optional: boolean;
}

/** Parse the `{name: type}` map into an array of FieldSpec rows. */
function parseDefinition(raw: string): FieldSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`schema: definition is not valid JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('schema: definition must be a JSON object mapping field names to type tags');
  }
  const out: FieldSpec[] = [];
  for (const rawKey of Object.keys(parsed)) {
    const value = (parsed as Record<string, unknown>)[rawKey];
    if (typeof value !== 'string') {
      throw new Error(`schema: definition.${rawKey} must be a type tag string`);
    }
    const optional = rawKey.endsWith('?');
    const name = optional ? rawKey.slice(0, -1) : rawKey;
    if (!ALLOWED_TYPES.has(value)) {
      throw new Error(`schema: unknown type tag "${value}" on field "${name}" (allowed: ${[...ALLOWED_TYPES].join(', ')})`);
    }
    out.push({ name, type: value, optional });
  }
  return out;
}

/** Type-check one value against one tag. Returns null on success, error string on failure. */
function checkValue(value: unknown, type: string): string | null {
  switch (type) {
    case 'any':     return null;
    case 'string':  return typeof value === 'string' ? null : 'expected string';
    case 'number':  return typeof value === 'number' && Number.isFinite(value) ? null : 'expected finite number';
    case 'integer': return typeof value === 'number' && Number.isInteger(value) ? null : 'expected integer';
    case 'boolean': return typeof value === 'boolean' ? null : 'expected boolean';
    case 'null':    return value === null ? null : 'expected null';
    case 'object':  return typeof value === 'object' && value !== null && !Array.isArray(value) ? null : 'expected object';
    case 'array':   return Array.isArray(value) ? null : 'expected array';
    default:        return `unknown type tag "${type}"`;
  }
}

/**
 * Validate `tuple` against `spec`. Aggregates every defect (no short-
 * circuit) so the user fixes the whole thing in one round.
 */
function validate(tuple: unknown, spec: FieldSpec[], strict: boolean): string[] {
  if (typeof tuple !== 'object' || tuple === null || Array.isArray(tuple)) {
    return ['target value is not a JSON object'];
  }
  const errors: string[] = [];
  const obj = tuple as Record<string, unknown>;
  const declared = new Set<string>();
  for (const f of spec) {
    declared.add(f.name);
    const present = Object.prototype.hasOwnProperty.call(obj, f.name);
    if (!present) {
      if (!f.optional) errors.push(`${f.name}: missing required field`);
      continue;
    }
    const err = checkValue(obj[f.name], f.type);
    if (err !== null) errors.push(`${f.name}: ${err}`);
  }
  if (strict) {
    for (const key of Object.keys(obj)) {
      if (!declared.has(key)) errors.push(`${key}: not declared in schema (strict mode)`);
    }
  }
  return errors;
}

const schemaNode: NodeModule = (RED) => {
  RED.nodes.registerType(NODE_TYPE, function (this: NodeInstance, config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const definition = cfgString(config, 'definition') ?? '{}';
    const target = cfgString(config, 'target') ?? 'payload';
    const strict = cfgBoolean(config, 'strict');

    let spec: FieldSpec[];
    try {
      spec = parseDefinition(definition);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      node.status({ fill: 'red', shape: 'ring', text: 'bad definition' });
      node.error(err);
      return;
    }

    let okCount = 0;
    let failCount = 0;
    node.status({ fill: 'green', shape: 'dot', text: `0 / 0` });

    node.on('input', (msg: NodeMessage, _send, done) => {
      try {
        const value = (msg as Record<string, unknown>)[target];
        const errors = validate(value, spec, strict);
        if (errors.length === 0) {
          okCount += 1;
          node.send([msg, null]); // port 0 = valid; port 1 = nothing
        } else {
          failCount += 1;
          const tagged: NodeMessage = { ...msg, errors };
          node.send([null, tagged]); // port 0 = nothing; port 1 = invalid
        }
        node.status({ fill: failCount === 0 ? 'green' : 'yellow', shape: 'dot', text: `${okCount} ok / ${failCount} bad` });
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
};

export default schemaNode;
