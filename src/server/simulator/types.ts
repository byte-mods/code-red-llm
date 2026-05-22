/**
 * Types for the simulation subsystem.
 *
 * Simulation is a dry-run execution of a flow: given a start node and
 * an input message, it walks the graph and records the message state at
 * each step without calling real connectors or deploying.
 */

import type { NodeMessage } from '../nodes/red-runtime.js';

export interface SimNode {
  readonly id: string;
  readonly type: string;
  readonly wires: ReadonlyArray<ReadonlyArray<string>>;
  readonly [key: string]: unknown;
}

export interface SimTraceEntry {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly input: NodeMessage;
  readonly output: NodeMessage;
  readonly status: 'ok' | 'error' | 'mock';
  readonly detail?: string;
}

export interface SimulationResult {
  readonly ok: boolean;
  readonly trace: readonly SimTraceEntry[];
  readonly error?: string;
}

export interface SimulatorContext {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly msg: NodeMessage;
}

export type NodeSimulator = (ctx: SimulatorContext) => NodeMessage | Promise<NodeMessage>;
