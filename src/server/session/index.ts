/**
 * Public surface of the session module. Consumers (the route layer)
 * import from here; never reach into individual files.
 */
export {
  GenerationRegistry,
  type RegistryEntry,
  type RegistryOptions,
  type GenerationSummary,
} from './registry.js';
export { HistoryWriter, type HistoryRecord, type ErrorSink } from './persistence.js';
