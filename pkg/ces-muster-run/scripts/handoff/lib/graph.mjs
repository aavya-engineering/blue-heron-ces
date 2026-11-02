// Build-order graph: topological sort (Kahn) with manifest-order tie-breaking, and cycle detection.

export class CycleError extends Error {
  constructor(cycle) {
    super(`dependency cycle: ${cycle.join(' -> ')}`);
    this.cycle = cycle;
  }
}

/** components: [{ id, deps: [] }] in manifest order. Returns ids in build order. */
export function buildOrder(components) {
  const ids = components.map((c) => c.id);
  const pos = new Map(ids.map((id, i) => [id, i]));
  for (const c of components) for (const d of c.deps ?? []) if (!pos.has(d)) throw new Error(`component "${c.id}" depends on unknown component "${d}"`);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map(ids.map((id) => [id, []]));
  for (const c of components) for (const d of new Set(c.deps ?? [])) {
    indeg.set(c.id, indeg.get(c.id) + 1);
    out.get(d).push(c.id);
  }
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (ready.length) {
    ready.sort((a, b) => pos.get(a) - pos.get(b));
    const id = ready.shift();
    order.push(id);
    for (const n of out.get(id)) {
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) ready.push(n);
    }
  }
  if (order.length !== ids.length) throw new CycleError(findCycle(components));
  return order;
}

function findCycle(components) {
  const deps = new Map(components.map((c) => [c.id, c.deps ?? []]));
  const state = new Map();
  const stack = [];
  let found = null;
  const visit = (id) => {
    if (found) return;
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id)) {
      if (found) return;
      if (state.get(d) === 1) {
        found = [...stack.slice(stack.indexOf(d)), d];
        return;
      }
      if (!state.get(d)) visit(d);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const c of components) if (!state.get(c.id)) visit(c.id);
  return found ?? ['(unknown)'];
}
