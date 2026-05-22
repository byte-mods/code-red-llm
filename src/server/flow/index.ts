/**
 * Flow validation barrel.
 *
 * Re-exports the structural validator so consumers import from
 * `./flow` rather than reaching into `./validator.ts` directly.
 */
export { validateFlow, type FlowIssue, type FlowValidationResult } from './validator.js';
export { handleValidate } from './routes.js';
export { validateWireTypes, type WireTypeIssue, type WireTypeValidationResult } from './wiretypes.js';
