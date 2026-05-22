/**
 * Public surface of the SSE module. Consumers import from this file; never
 * reach into ./writer.ts or ./generate.ts directly.
 */
export { createSseStream, encodeFrame, type SseStream } from './writer.js';
export { handleGenerate, type GenerateDeps } from './generate.js';
export { handleListGenerations, handleCancelGeneration } from './admin.js';
