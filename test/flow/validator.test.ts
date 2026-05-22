/**
 * Tests for the structural flow validator.
 *
 * Naming: test_flow_validator_<scenario>_<expected>.
 */
import { describe, expect, it } from 'vitest';

import { validateFlow } from '../../src/server/flow/index.js';
import type { NodeRedNode } from '../../src/server/extractor/types.js';

function makeNode(p: Partial<NodeRedNode> & { id: string }): NodeRedNode {
  return {
    id: p.id,
    type: p.type ?? 'debug',
    x: p.x ?? 100,
    y: p.y ?? 100,
    wires: p.wires ?? [],
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.z !== undefined ? { z: p.z } : {}),
    extras: p.extras ?? {},
  };
}

describe('validateFlow — null safety', () => {
  it('test_flow_validator_null_nodes_does_not_throw', () => {
    const r = validateFlow(null as unknown as readonly unknown[]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.type).toBe('bad-wires-shape');
  });

  it('test_flow_validator_undefined_nodes_does_not_throw', () => {
    const r = validateFlow(undefined as unknown as readonly unknown[]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.type).toBe('bad-wires-shape');
  });

  it('test_flow_validator_non_array_nodes_does_not_throw', () => {
    const r = validateFlow({} as unknown as readonly unknown[]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.type).toBe('bad-wires-shape');
  });

  it('test_flow_validator_primitive_nodes_does_not_throw', () => {
    const r = validateFlow(42 as unknown as readonly unknown[]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.type).toBe('bad-wires-shape');
  });

  it('test_flow_validator_null_existingIds_does_not_throw', () => {
    const r = validateFlow([makeNode({ id: 'a', wires: [['b']] })], null as unknown as ReadonlySet<string>);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'dangling-wire')).toBe(true);
  });

  it('test_flow_validator_array_existingIds_does_not_throw', () => {
    const r = validateFlow([makeNode({ id: 'a', wires: [['b']] })], ['b'] as unknown as ReadonlySet<string>);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'dangling-wire')).toBe(true);
  });

  it('test_flow_validator_throwing_has_existingIds_does_not_throw', () => {
    const evil = { has: () => { throw new Error('boom'); } } as unknown as ReadonlySet<string>;
    const r = validateFlow([makeNode({ id: 'a', wires: [['b']] })], evil);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'dangling-wire')).toBe(true);
  });

  it('test_flow_validator_proxy_nodes_does_not_throw', () => {
    const proxy = new Proxy([] as unknown[], {
      get(t, p) { if (p === 'length') throw new Error('proxy'); return Reflect.get(t, p); },
    });
    const r = validateFlow(proxy as readonly unknown[]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.detail).toContain('proxy');
  });

  it('test_flow_validator_proxy_node_element_does_not_throw', () => {
    const proxyNode = new Proxy({}, { get() { throw new Error('elem'); } });
    const r = validateFlow([proxyNode as unknown as NodeRedNode]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.detail).toContain('elem');
  });
});

describe('validateFlow — happy path', () => {
  it('test_flow_validator_empty_array_passes', () => {
    const r = validateFlow([]);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('test_flow_validator_single_node_no_wires_passes', () => {
    const r = validateFlow([makeNode({ id: 'a' })]);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('test_flow_validator_two_nodes_wired_passes', () => {
    const r = validateFlow([
      makeNode({ id: 'a', wires: [['b']] }),
      makeNode({ id: 'b' }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('test_flow_validator_dangling_wire_to_existing_id_passes', () => {
    const r = validateFlow(
      [makeNode({ id: 'a', wires: [['old-1']] })],
      new Set(['old-1']),
    );
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});

describe('validateFlow — duplicate ids', () => {
  it('test_flow_validator_duplicate_ids_fails', () => {
    const r = validateFlow([makeNode({ id: 'a' }), makeNode({ id: 'a' })]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'duplicate-id')).toBe(true);
  });
});

describe('validateFlow — dangling wires', () => {
  it('test_flow_validator_dangling_wire_fails', () => {
    const r = validateFlow([makeNode({ id: 'a', wires: [['missing']] })]);
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.type === 'dangling-wire');
    expect(issue).toBeDefined();
    expect(issue!.detail).toContain('missing');
  });
});

describe('validateFlow — self wires', () => {
  it('test_flow_validator_self_wire_fails', () => {
    const r = validateFlow([makeNode({ id: 'a', wires: [['a']] })]);
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.type === 'self-wire');
    expect(issue).toBeDefined();
    expect(issue!.nodeId).toBe('a');
  });
});

describe('validateFlow — bad coordinates', () => {
  it('test_flow_validator_nan_x_fails', () => {
    const r = validateFlow([makeNode({ id: 'a', x: NaN })]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-coordinate' && i.detail.includes('x'))).toBe(true);
  });

  it('test_flow_validator_infinite_y_fails', () => {
    const r = validateFlow([makeNode({ id: 'a', y: Infinity })]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-coordinate' && i.detail.includes('y'))).toBe(true);
  });
});

describe('validateFlow — bad wires shape', () => {
  it('test_flow_validator_non_object_element_fails', () => {
    const r = validateFlow([null as unknown as NodeRedNode]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-wires-shape')).toBe(true);
  });

  it('test_flow_validator_missing_x_fails', () => {
    const r = validateFlow([{ id: 'a', type: 'debug', y: 100, wires: [], extras: {} } as unknown as NodeRedNode]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-coordinate' && i.detail.includes('x'))).toBe(true);
  });

  it('test_flow_validator_non_number_y_fails', () => {
    const r = validateFlow([{ id: 'a', type: 'debug', x: 100, y: 'bad', wires: [], extras: {} } as unknown as NodeRedNode]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-coordinate' && i.detail.includes('y'))).toBe(true);
  });

  it('test_flow_validator_non_array_wires_fails', () => {
    const r = validateFlow([{ id: 'a', type: 'debug', x: 0, y: 0, wires: 'bad', extras: {} } as unknown as NodeRedNode]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-wires-shape')).toBe(true);
  });

  it('test_flow_validator_non_string_wire_target_fails', () => {
    const r = validateFlow([makeNode({ id: 'a', wires: [[123 as unknown as string]] })]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-wires-shape')).toBe(true);
  });

  it('test_flow_validator_non_array_port_fails', () => {
    const r = validateFlow([makeNode({ id: 'a', wires: ['bad' as unknown as string[]] })]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.type === 'bad-wires-shape')).toBe(true);
  });
});

describe('validateFlow — aggregates all issues', () => {
  it('test_flow_validator_returns_every_issue_at_once', () => {
    const r = validateFlow([
      makeNode({ id: 'a', x: NaN, wires: [['a', 'missing']] }),
      makeNode({ id: 'a', y: Infinity }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThanOrEqual(4);
    const types = new Set(r.issues.map((i) => i.type));
    expect(types.has('duplicate-id')).toBe(true);
    expect(types.has('self-wire')).toBe(true);
    expect(types.has('dangling-wire')).toBe(true);
    expect(types.has('bad-coordinate')).toBe(true);
  });
});
