/**
 * Types for the custom-node authoring subsystem (S10).
 *
 * Custom nodes live at:
 *   <project>/custom-nodes/<name>.ts
 *   <project>/custom-nodes/<name>.html
 *
 * They follow the same shape as the built-in connectors under
 * src/server/nodes/ — i.e. a default-export NodeModule that calls
 * RED.nodes.registerType. The plugin scans the directory at startup
 * and dynamic-imports each `.js` (post-build) or `.ts` (via tsx in
 * dev mode).
 */

export interface CustomNodeSummary {
  /** Filename stem — same as the node type id. */
  readonly name: string;
  /** Visibility — kept simple at v1: just one flat dir. */
  readonly visibility: 'public';
  /** Absolute path of the .ts source file. */
  readonly tsPath: string;
  /** Absolute path of the .html config form. */
  readonly htmlPath: string;
  /** Whether the compiled .js exists in dist/. */
  readonly built: boolean;
  /** UNIX mtime of the source file (for cache-busting / freshness display). */
  readonly mtime: number;
}

/**
 * Body the POST /custom-nodes route accepts.
 */
export interface CreateCustomNodeRequest {
  /** Node type id — lowercase, kebab-case. */
  readonly name: string;
  /** Plain-English description of what the node should do. */
  readonly description: string;
  /** If true, the route asks Claude to generate the TS + HTML.
   *  If false, the body must include `tsSource` and `htmlSource`. */
  readonly generate: boolean;
  /** Manual TS source — required when generate=false. */
  readonly tsSource?: string;
  /** Manual HTML source — required when generate=false. */
  readonly htmlSource?: string;
}

export interface CreateCustomNodeResponse {
  readonly name: string;
  readonly tsPath: string;
  readonly htmlPath: string;
  /** True if Claude generated the code; false if user-supplied. */
  readonly generated: boolean;
  /** Hint to the operator. Node-RED needs a restart for new nodes to load. */
  readonly hint: string;
}
