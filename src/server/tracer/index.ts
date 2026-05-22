/**
 * Public surface of the tracer subsystem.
 */
export { tracerBus, type TracerSnapshot, type TracerMode } from './bus.js';
export {
  handleListTracers,
  handleTracerEvents,
  handlePauseTracer,
  handleResumeTracer,
  handleStepTracer,
} from './routes.js';
