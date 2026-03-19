/**
 * Dependency graph utilities for plan step scheduling.
 */

interface SchedulableStep {
  id: string;
  depends_on: string[] | null;
  status: string;
}

/**
 * Returns true if the dependency graph is acyclic (valid).
 */
export function validateDependencyGraph(steps: SchedulableStep[]): boolean {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const s of steps) {
    adj.set(s.id, []);
    inDegree.set(s.id, 0);
  }

  for (const s of steps) {
    for (const dep of s.depends_on ?? []) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(s.id);
        inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return visited === steps.length;
}

/**
 * Given completed step IDs, returns steps whose dependencies are all satisfied.
 */
export function getReadySteps(
  steps: SchedulableStep[],
  completedIds: Set<string>,
  runningIds: Set<string>,
): SchedulableStep[] {
  return steps.filter((s) => {
    if (s.status !== "approved") return false;
    if (completedIds.has(s.id) || runningIds.has(s.id)) return false;
    return (s.depends_on ?? []).every((dep) => completedIds.has(dep));
  });
}
