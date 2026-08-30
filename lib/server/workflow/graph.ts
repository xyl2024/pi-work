/**
 * Pure workflow DAG helpers — cycle detection and automatic layered layout.
 *
 * Kept dependency-free (only type imports) so the store can use them and they
 * stay trivially unit-testable in isolation.
 */
import type { WorkflowNode } from "@/lib/shared/workflow";

/**
 * Throw if the dependsOn edge set contains a cycle (would stall execution).
 * Edges must already be resolved to valid, distinct node ids.
 */
export function assertNoCycle(nodes: WorkflowNode[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (node: WorkflowNode, path: string[]): void => {
    if (done.has(node.id)) return;
    if (visiting.has(node.id)) {
      throw new Error(`workflow has a circular dependency: ${[...path, node.name].join(" → ")}`);
    }
    visiting.add(node.id);
    for (const depId of node.dependsOn) {
      const dep = byId.get(depId);
      if (dep) visit(dep, [...path, node.name]);
    }
    visiting.delete(node.id);
    done.add(node.id);
  };
  for (const n of nodes) visit(n, []);
}

/** Left-to-right layered layout driven by the dependsOn graph.
 *
 *  layer(n) = 0 for roots, else 1 + max(layer(dep)). Nodes in the same layer
 *  are stacked vertically and the column is centered so independent branches
 *  stay tidy. Mutates the input nodes' x/y in place. */
export function autoLayeredLayout(nodes: WorkflowNode[]): void {
  if (nodes.length === 0) return;
  const GX = 264;
  const GY = 96;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layer = new Map<string, number>();
  const computeLayer = (id: string): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node || node.dependsOn.length === 0) {
      layer.set(id, 0);
      return 0;
    }
    const depLayers = node.dependsOn.map((d) => computeLayer(d));
    const l = 1 + Math.max(0, ...depLayers);
    layer.set(id, l);
    return l;
  };
  for (const n of nodes) computeLayer(n.id);

  const byLayer = new Map<number, WorkflowNode[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(n);
    byLayer.set(l, arr);
  }
  let maxY = 0;
  for (const [, arr] of byLayer) maxY = Math.max(maxY, (arr.length - 1) * GY);
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    n.x = 30 + l * GX;
    n.y = 40 + arr.indexOf(n) * GY + (maxY - (arr.length - 1) * GY) / 2;
  }
}