/**
 * Schema compatibility engine.
 *
 * Pure functions that determine whether one schema (field → type tag map)
 * can satisfy another. Used by the wire-type validator to check that
 * upstream output matches downstream input expectations.
 */

/** Check if a single source type tag satisfies a target type tag. */
export function areTypesCompatible(source: string, target: string): boolean {
  if (target === 'any' || source === 'any') return true;
  if (source === target) return true;
  return false;
}

/** Parse a type tag, stripping the optional `?` suffix. */
function parseTypeTag(tag: string): { type: string; optional: boolean } {
  const optional = tag.endsWith('?');
  return { type: optional ? tag.slice(0, -1) : tag, optional };
}

/**
 * Check whether `source` schema satisfies `target` schema.
 * Returns a list of human-readable incompatibilities (empty = compatible).
 *
 * The optional marker `?` is on the **key** (field name), matching the
 * schema node's definition format: `{ "count?": "number" }` means
 * field `count` is optional and must be a number when present.
 */
export function checkSchemaCompat(
  source: Readonly<Record<string, string>>,
  target: Readonly<Record<string, string>>,
): string[] {
  const errors: string[] = [];
  for (const [rawKey, rawTag] of Object.entries(target)) {
    const { type: fieldName, optional: targetOptional } = parseTypeTag(rawKey);
    const targetType = parseTypeTag(rawTag).type;
    const sourceTag = source[fieldName];
    if (sourceTag === undefined) {
      if (!targetOptional) {
        errors.push(`missing required field "${fieldName}" (expected ${targetType})`);
      }
      continue;
    }
    const sourceType = parseTypeTag(sourceTag).type;
    if (!areTypesCompatible(sourceType, targetType)) {
      errors.push(`field "${fieldName}": expected ${targetType}, source provides ${sourceType}`);
    }
  }
  return errors;
}
