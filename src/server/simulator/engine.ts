/**
 * Simulation engine.
 *
 * Given a flow (array of nodes), a start node id, and an input message,
 * walk the graph and record the message state at each step.
 *
 * Limitations (v1):
 *   - Follows all wires (fan-out) breadth-first.
 *   - Stops after 100 steps to prevent infinite loops.
 *   - Cycles are detected and break the branch.
 *   - Async simulators are awaited.
 */
import type { NodeMessage } from '../nodes/red-runtime.js';
import type { SimNode, SimTraceEntry, SimulationResult } from './types.js';
import { getSimulator } from './registry.js';

const MAX_STEPS = 100;

export async function simulateFlow(
  nodes: readonly SimNode[],
  startNodeId: string,
  msg: NodeMessage,
): Promise<SimulationResult> {
  const byId = new Map<string, SimNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
  }

  if (!byId.has(startNodeId)) {
    return { ok: false, trace: [], error: `start node "${startNodeId}" not found in flow` };
  }

  const trace: SimTraceEntry[] = [];
  const visited = new Set<string>(); // for cycle detection per branch
  let steps = 0;

  // BFS queue: {nodeId, msg}
  type QueueItem = { nodeId: string; msg: NodeMessage };
  const queue: QueueItem[] = [{ nodeId: startNodeId, msg }];

  while (queue.length > 0 && steps < MAX_STEPS) {
    const { nodeId, msg: inputMsg } = queue.shift()!;
    const node = byId.get(nodeId);
    if (node === undefined) continue;

    steps++;

    // Cycle guard: if we've already processed this node in this path,
    // we break. For v1 we use a global visited set per simulation run.
    if (visited.has(nodeId)) {
      trace.push({
        nodeId,
        nodeType: node.type,
        input: inputMsg,
        output: inputMsg,
        status: 'mock',
        detail: 'cycle detected — branch terminated',
      });
      continue;
    }
    visited.add(nodeId);

    const simulator = getSimulator(node.type);
    let outputMsg: NodeMessage;
    let status: SimTraceEntry['status'] = 'ok';
    let detail: string | undefined;

    try {
      outputMsg = await simulator({
        nodeId,
        nodeType: node.type,
        config: node as Record<string, unknown>,
        msg: inputMsg,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      outputMsg = inputMsg;
      status = 'error';
      detail = err;
    }

    const entry: SimTraceEntry = { nodeId, nodeType: node.type, input: inputMsg, output: outputMsg, status };
    if (detail !== undefined) (entry as unknown as Record<string, unknown>).detail = detail;
    trace.push(entry);

    // Enqueue downstream nodes.
    for (const port of node.wires) {
      for (const targetId of port) {
        if (byId.has(targetId)) {
          queue.push({ nodeId: targetId, msg: outputMsg });
        }
      }
    }
  }

  if (steps >= MAX_STEPS) {
    return { ok: false, trace, error: `simulation exceeded ${String(MAX_STEPS)} steps — possible infinite loop` };
  }

  return { ok: true, trace };
}
