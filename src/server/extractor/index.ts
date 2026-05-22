/**
 * Public surface of the extractor module. Consumers (S4 SSE layer, future
 * tests) import from this file — never reach into ./validator.ts,
 * ./extractor.ts, or ./types.ts directly.
 */
export { validateNode } from './validator.js';
export { extractNodes } from './extractor.js';
export type {
  NodeRedNode,
  ValidationResult,
  NodeExtractionResult,
  ExtractionErrorReason,
} from './types.js';
