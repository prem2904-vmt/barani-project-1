/**
 * Pure tree edits for the Families editor (Test Master → Families). A node is
 * addressed by its INDEX path from the root ([1] = second answer, [1, 0] =
 * its first sub-choice). Every edit returns a new definition (immutable), so
 * the editor's signal always changes identity and the template re-renders.
 */
import {
  FAMILY_MAX_DEPTH, type FamilyChildren, type FamilyNode, type FamilyQtyKind, type OptionFamily,
} from '../../../../shared/utils/option-family';

type NodeFn = (n: FamilyNode) => FamilyNode;

/** The sibling list a parent path opens ([] = the root answers). */
export function nodesAt(def: OptionFamily, parentPath: readonly number[]): FamilyNode[] | null {
  let nodes = def.nodes;
  for (const i of parentPath) {
    const n = nodes[i];
    if (!n?.children) return null;
    nodes = n.children.nodes;
  }
  return nodes;
}

/** Replace the sibling list under `parentPath`. */
export function withNodesAt(def: OptionFamily, parentPath: readonly number[], fn: (nodes: FamilyNode[]) => FamilyNode[]): OptionFamily {
  const rec = (nodes: FamilyNode[], rest: readonly number[]): FamilyNode[] => {
    if (!rest.length) return fn(nodes);
    return nodes.map((n, i) => i !== rest[0] || !n.children ? n
      : { ...n, children: { ...n.children, nodes: rec(n.children.nodes, rest.slice(1)) } });
  };
  return { ...def, nodes: rec(def.nodes, parentPath) };
}

/** Apply `fn` to the node at `path`. */
export function updateNode(def: OptionFamily, path: readonly number[], fn: NodeFn): OptionFamily {
  if (!path.length) return def;
  const last = path[path.length - 1];
  return withNodesAt(def, path.slice(0, -1), nodes => nodes.map((n, i) => (i === last ? fn(n) : n)));
}

export function addNode(def: OptionFamily, parentPath: readonly number[]): OptionFamily {
  return withNodesAt(def, parentPath, nodes => [...nodes, { code: '', label: '' }]);
}

export function removeNode(def: OptionFamily, path: readonly number[]): OptionFamily {
  const last = path[path.length - 1];
  return withNodesAt(def, path.slice(0, -1), nodes => nodes.filter((_, i) => i !== last));
}

export function moveNode(def: OptionFamily, path: readonly number[], delta: -1 | 1): OptionFamily {
  const last = path[path.length - 1];
  return withNodesAt(def, path.slice(0, -1), nodes => {
    const to = last + delta;
    if (to < 0 || to >= nodes.length) return nodes;
    const next = [...nodes];
    [next[last], next[to]] = [next[to], next[last]];
    return next;
  });
}

/** Open a sub-list under a node — refused past the maximum depth. */
export function addChildren(def: OptionFamily, path: readonly number[]): OptionFamily {
  if (path.length >= FAMILY_MAX_DEPTH) return def;
  return updateNode(def, path, n => n.children ? n
    : { ...n, children: { label: '', multi: true, nodes: [{ code: '', label: '' }] } });
}

export function setQtyKind(n: FamilyNode, kind: FamilyQtyKind | ''): FamilyNode {
  const { qty: _q, ...rest } = n;
  void _q;
  if (!kind) return rest;
  const unit = n.qty?.unit ?? undefined;
  if (kind === 'choice') return { ...rest, qty: { kind, options: n.qty?.options?.length ? n.qty.options : ['Few', 'Moderate', 'Many'], ...(unit ? { unit } : {}) } };
  return { ...rest, qty: { kind, ...(unit ? { unit } : {}) } };
}

/** "Few, Moderate ,, Many" → ['Few','Moderate','Many']. */
export function parseOptionList(text: string): string[] {
  return String(text ?? '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}

/** Signal-bound edits for the editor template. */
/** Anything signal-shaped holding the draft (a WritableSignal or a model()). */
export interface DraftRef { (): OptionFamily | null; set(v: OptionFamily): void }

export function familyTreeOps(draft: DraftRef) {
  const edit = (fn: (d: OptionFamily) => OptionFamily) => { const d = draft(); if (d) draft.set(fn(d)); };
  const node = (path: readonly number[], fn: NodeFn) => edit(d => updateNode(d, path, fn));
  const kids = (path: readonly number[], fn: (k: FamilyChildren) => FamilyChildren) =>
    node(path, n => (n.children ? { ...n, children: fn(n.children) } : n));
  return {
    setActive: (on: boolean) => edit(d => ({ ...d, active: on })),
    setLabel: (path: readonly number[], label: string) => node(path, n => ({ ...n, label })),
    setNormal: (path: readonly number[], normal: boolean) => node(path, n => ({ ...n, normal })),
    addNode: (parentPath: readonly number[]) => edit(d => addNode(d, parentPath)),
    remove: (path: readonly number[]) => edit(d => removeNode(d, path)),
    move: (path: readonly number[], delta: -1 | 1) => edit(d => moveNode(d, path, delta)),
    addChildren: (path: readonly number[]) => edit(d => addChildren(d, path)),
    removeChildren: (path: readonly number[]) => node(path, n => { const { children: _c, ...rest } = n; void _c; return rest; }),
    setChildrenLabel: (path: readonly number[], label: string) => kids(path, k => ({ ...k, label })),
    setMulti: (path: readonly number[], multi: boolean) => kids(path, k => ({ ...k, multi })),
    setQtyKind: (path: readonly number[], kind: FamilyQtyKind | '') => node(path, n => setQtyKind(n, kind)),
    setQtyOptions: (path: readonly number[], text: string) =>
      node(path, n => (n.qty ? { ...n, qty: { ...n.qty, options: parseOptionList(text) } } : n)),
    setQtyUnit: (path: readonly number[], unit: string) =>
      node(path, n => (n.qty ? { ...n, qty: { ...n.qty, unit: unit.trim() ? unit : null } } : n)),
    /** Give a code-less node a code from its label (codes never change after). */
    ensureCode: (path: readonly number[], make: (label: string, taken: string[]) => string) => edit(d => {
      const siblings = nodesAt(d, path.slice(0, -1)) ?? [];
      const me = siblings[path[path.length - 1]];
      if (!me || me.code || !me.label.trim()) return d;
      const taken = siblings.filter(s => s !== me).map(s => s.code).filter(Boolean);
      return updateNode(d, path, n => ({ ...n, code: make(n.label, taken) }));
    }),
  };
}

/** Every labelled node without a code gets one from its label (unique among
 *  its siblings); existing codes never change. */
export function fillCodes(def: OptionFamily, make: (label: string, taken: string[]) => string): OptionFamily {
  const rec = (nodes: FamilyNode[]): FamilyNode[] => {
    const taken = nodes.map(n => n.code).filter(Boolean);
    return nodes.map(n => {
      let out = n;
      if (!n.code && n.label.trim()) {
        const code = make(n.label, taken);
        taken.push(code);
        out = { ...n, code };
      }
      return out.children ? { ...out, children: { ...out.children, nodes: rec(out.children.nodes) } } : out;
    });
  };
  return { ...def, nodes: rec(def.nodes) };
}
