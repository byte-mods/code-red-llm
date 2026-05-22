/**
 * Narrow types for validated Node-RED nodes, schema definitions, and the
 * extractor's per-block result envelope.
 *
 * The minimal node shape covers what `RED.nodes.add()` actually requires to
 * place a node on the editor canvas. Type-specific fields (url, method,
 * func, …) flow through the catch-all `extras` map so callers can hand
 * them straight to Node-RED without losing data.
 */

/** A validated Node-RED node, the shape `RED.nodes.add()` will accept. */
export interface NodeRedNode {
  /** Stable identifier. The model assigns it; we do not generate ids. */
  readonly id: string;
  /** Node-RED node type, e.g. "inject", "http request", "debug". */
  readonly type: string;
  /** Canvas X coordinate (pixels). Must be finite. */
  readonly x: number;
  /** Canvas Y coordinate (pixels). Must be finite. */
  readonly y: number;
  /** One inner array per output port; each holds target node ids. */
  readonly wires: ReadonlyArray<ReadonlyArray<string>>;
  /** Optional display name. */
  readonly name?: string;
  /** Optional flow (tab) id. The editor will fill it in if absent. */
  readonly z?: string;
  /** Any other type-specific fields pass through unmodified. */
  readonly extras: Readonly<Record<string, unknown>>;
}

/**
 * Schema definition emitted by the LLM to describe the expected output
 * shape of a node. Used by the wire-type validator (T3).
 */
export interface SchemaDefinition {
  /** The node id this schema describes. */
  readonly nodeId: string;
  /** Field name → type tag mapping. */
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * Result of validating a single candidate object. PASS yields the narrowed
 * node; FAIL yields the full list of validation errors so the caller can
 * surface them all at once. Never throws.
 */
export type ValidationResult =
  | { readonly ok: true; readonly node: NodeRedNode }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * What the extractor yields for each complete sentinel block it sees.
 * `kind: 'node'` is a validated node; `kind: 'schema'` is a typed schema;
 * `kind: 'error'` is a structured failure (malformed JSON inside the
 * sentinels, validation failure, or runaway-sentinel buffer overflow). The
 * stream continues either way.
 */
export type ExtractionResult =
  | { readonly kind: 'node'; readonly node: NodeRedNode }
  | { readonly kind: 'schema'; readonly schema: SchemaDefinition }
  | { readonly kind: 'error'; readonly reason: ExtractionErrorReason; readonly detail: string };

/** The reasons the extractor produces an `error` result instead of a node. */
export type ExtractionErrorReason =
  | 'malformed-json' // JSON.parse failed inside the sentinels
  | 'not-an-object' // Parsed but it wasn't a JSON object
  | 'validation-failed' // Validator returned ok:false
  | 'runaway-sentinel'; // Open sentinel found, buffer cap exceeded before close
