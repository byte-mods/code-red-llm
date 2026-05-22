/**
 * Public surface of the prompt module. All consumers import from this file —
 * never reach into ./template.ts directly, so the file layout stays free
 * to refactor.
 */
export {
  buildPrompt,
  SENTINEL_OPEN,
  SENTINEL_CLOSE,
  SENTINEL_SCHEMA_OPEN,
  SENTINEL_SCHEMA_CLOSE,
  type PromptOptions,
} from './template.js';
