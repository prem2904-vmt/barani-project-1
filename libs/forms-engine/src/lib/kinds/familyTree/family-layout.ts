/**
 * Where each relative sits on the pedigree. Mirror of the server's `FamilyLayout.cs`: a fixed layout by relationship (pitch 80 between symbols,
 * symbols 44 wide, rows 120 apart, whole numbers), pinned by the shared vectors so the screen and the printout agree.
 */
export interface FamNode {
  id: string;
  relation: string;
  sex: 'male' | 'female' | 'unknown';
  shape: 'square' | 'circle' | 'diamond';
  x: number;
  y: number;
  proband: boolean;
  deceased: boolean;
  conditions: string[];
  name?: string;
  age?: number;
  ageAtDeath?: number;
  note?: string;
  /** 1.. in reading order; the number on the symbol. */
  number: number;
}

export interface FamLine {
  kind: 'marriage' | 'descent';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  double: boolean;
}

export interface FamLayout {
  nodes: FamNode[];
  lines: FamLine[];
  width: number;
  height: number;
}

export const SIZE = 44;
export const PITCH = 80;
export const GROUP_GAP = 40;
export const ROW = 120;
export const MARGIN = 40;

export const RELATIONS = [
  'paternalGrandfather',
  'paternalGrandmother',
  'maternalGrandfather',
  'maternalGrandmother',
  'paternalUncle',
  'paternalAunt',
  'father',
  'mother',
  'maternalUncle',
  'maternalAunt',
  'brother',
  'sister',
  'spouse',
  'son',
  'daughter',
] as const;
export type Relation = (typeof RELATIONS)[number];

export const WORDS: Record<Relation, string> = {
  paternalGrandfather: 'paternal grandfather',
  paternalGrandmother: 'paternal grandmother',
  maternalGrandfather: 'maternal grandfather',
  maternalGrandmother: 'maternal grandmother',
  paternalUncle: 'paternal uncle',
  paternalAunt: 'paternal aunt',
  father: 'father',
  mother: 'mother',
  maternalUncle: 'maternal uncle',
  maternalAunt: 'maternal aunt',
  brother: 'brother',
  sister: 'sister',
  spouse: 'spouse',
  son: 'son',
  daughter: 'daughter',
};

/** The order the "add a relative" list offers them in (close family first). */
export const ADD_ORDER: Relation[] = [
  'father',
  'mother',
  'brother',
  'sister',
  'spouse',
  'son',
  'daughter',
  'paternalGrandfather',
  'paternalGrandmother',
  'maternalGrandfather',
  'maternalGrandmother',
  'paternalUncle',
  'paternalAunt',
  'maternalUncle',
  'maternalAunt',
];

/** Relations only one person can have. */
export const SINGLE = new Set<string>(['paternalGrandfather', 'paternalGrandmother', 'maternalGrandfather', 'maternalGrandmother', 'father', 'mother', 'spouse']);

const MALE = new Set<string>(['paternalGrandfather', 'maternalGrandfather', 'paternalUncle', 'maternalUncle', 'father', 'brother', 'son']);
const FEMALE = new Set<string>(['paternalGrandmother', 'maternalGrandmother', 'paternalAunt', 'maternalAunt', 'mother', 'sister', 'daughter']);

type Sex = FamNode['sex'];

export function sexOf(relation: string, given: string | undefined, selfSex: Sex): Sex {
  if (MALE.has(relation)) return 'male';
  if (FEMALE.has(relation)) return 'female';
  if (given === 'male' || given === 'female' || given === 'unknown') return given;
  return selfSex === 'male' ? 'female' : selfSex === 'female' ? 'male' : 'unknown';
}

const shapeOf = (sex: Sex): FamNode['shape'] => (sex === 'male' ? 'square' : sex === 'female' ? 'circle' : 'diamond');

export interface FamilyPerson {
  relation: string;
  sex?: string;
  name?: string;
  age?: number;
  deceased?: boolean;
  ageAtDeath?: number;
  conditions?: string[];
  note?: string;
}

export interface FamilyAnswer {
  self?: { sex?: string; conditions?: string[] };
  people?: FamilyPerson[];
  consanguinity?: { parents?: boolean; spouse?: boolean };
  noHistory?: boolean;
}

const conds = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))] : [];
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined);
const half = (n: number): number => Math.trunc(n / 2);

export function buildLayout(answer: FamilyAnswer | null | undefined): FamLayout {
  const o = answer ?? {};
  const selfSex: Sex = o.self?.sex === 'male' || o.self?.sex === 'female' ? o.self.sex : 'unknown';
  const consParents = o.consanguinity?.parents === true;
  const consSpouse = o.consanguinity?.spouse === true;

  const nodes: FamNode[] = [];
  (o.people ?? []).forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const rel = String(p.relation ?? '');
    if (!(rel in WORDS)) return;
    if (SINGLE.has(rel) && nodes.some((n) => n.relation === rel)) return;
    const sex = sexOf(rel, p.sex, selfSex);
    nodes.push({
      id: 'p' + i,
      relation: rel,
      sex,
      shape: shapeOf(sex),
      x: 0,
      y: 0,
      proband: false,
      deceased: p.deceased === true,
      conditions: conds(p.conditions),
      name: text(p.name),
      age: int(p.age),
      ageAtDeath: int(p.ageAtDeath),
      note: text(p.note),
      number: 0,
    });
  });
  const self: FamNode = {
    id: 'self',
    relation: 'self',
    sex: selfSex,
    shape: shapeOf(selfSex),
    x: 0,
    y: 0,
    proband: true,
    deceased: false,
    conditions: conds(o.self?.conditions),
    number: 0,
  };

  const of = (...rels: string[]) => nodes.filter((n) => rels.includes(n.relation));
  const one = (rel: string) => nodes.find((n) => n.relation === rel);

  const pSibs = of('paternalUncle', 'paternalAunt');
  const father = one('father');
  const mother = one('mother');
  const mSibs = of('maternalUncle', 'maternalAunt');
  const pgf = one('paternalGrandfather');
  const pgm = one('paternalGrandmother');
  const mgf = one('maternalGrandfather');
  const mgm = one('maternalGrandmother');
  const sibs = of('brother', 'sister');
  const spouse = one('spouse');
  const kids = of('son', 'daughter');
  const pGrand = [pgf, pgm].filter((n): n is FamNode => !!n);
  const mGrand = [mgf, mgm].filter((n): n is FamNode => !!n);

  const hasGrand = pGrand.length + mGrand.length > 0;
  const rowOf = new Map<number, number>();
  let next = 0;
  if (hasGrand) rowOf.set(0, next++);
  rowOf.set(1, next++);
  rowOf.set(2, next++);
  if (kids.length > 0) rowOf.set(3, next++);
  const Y = (gen: number) => MARGIN + rowOf.get(gen)! * ROW;

  // row 2 (generation 1)
  let x = 0;
  const place = (row: FamNode[], gen: number) => {
    for (const n of row) {
      n.x = x;
      n.y = Y(gen);
      x += PITCH;
    }
  };
  place(pSibs, 1);
  if (pSibs.length > 0 && (father || mother || mSibs.length > 0)) x += GROUP_GAP;
  if (father) place([father], 1);
  if (mother) place([mother], 1);
  if (mSibs.length > 0 && (father || mother || pSibs.length > 0)) x += GROUP_GAP;
  place(mSibs, 1);

  // row 3
  const sibship = [...sibs, self];
  x = 0;
  for (const n of sibship) {
    n.x = x;
    n.y = Y(2);
    x += PITCH;
  }
  if (spouse) {
    spouse.x = self.x + PITCH;
    spouse.y = Y(2);
  }
  const parentMid = father && mother ? half(father.x + mother.x) : (father ?? mother)?.x;
  if (parentMid !== undefined) {
    const shift = parentMid - half(sibship[0].x + self.x);
    for (const n of sibship) n.x += shift;
    if (spouse) spouse.x += shift;
  }

  // row 4
  if (kids.length > 0) {
    const anchor = spouse ? half(self.x + spouse.x) : self.x;
    const left = anchor - half((kids.length - 1) * PITCH);
    kids.forEach((k, i) => {
      k.x = left + i * PITCH;
      k.y = Y(3);
    });
  }

  // row 1
  if (hasGrand) {
    const over = (g: FamNode[]) => half(Math.min(...g.map((n) => n.x)) + Math.max(...g.map((n) => n.x)));
    const couple = (a: FamNode | undefined, b: FamNode | undefined, mid: number) => {
      const l = [a, b].filter((n): n is FamNode => !!n);
      const start = mid - half((l.length - 1) * PITCH);
      l.forEach((n, i) => {
        n.x = start + i * PITCH;
        n.y = Y(0);
      });
    };
    const pSide = [...pSibs, ...(father ? [father] : [])];
    const mSide = [...(mother ? [mother] : []), ...mSibs];
    if (pGrand.length > 0) couple(pgf, pgm, pSide.length > 0 ? over(pSide) : 0);
    if (mGrand.length > 0) {
      couple(mgf, mgm, mSide.length > 0 ? over(mSide) : pGrand.length > 0 ? Math.max(...pGrand.map((n) => n.x)) + PITCH + GROUP_GAP + half(PITCH) : 0);
      if (pGrand.length > 0) {
        const need = Math.max(...pGrand.map((n) => n.x)) + PITCH + GROUP_GAP - Math.min(...mGrand.map((n) => n.x));
        if (need > 0) for (const n of mGrand) n.x += need;
      }
    }
  }

  // normalise
  const all = [...nodes, self];
  const dx = MARGIN - Math.min(...all.map((n) => n.x));
  for (const n of all) n.x += dx;
  const ordered = [...all].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ordered.forEach((n, i) => (n.number = i + 1));
  const width = Math.max(...all.map((n) => n.x)) + MARGIN;
  const height = Math.max(...all.map((n) => n.y)) + MARGIN;

  // lines
  const lines: FamLine[] = [];
  const marriage = (a: FamNode, b: FamNode, dbl: boolean) =>
    lines.push({ kind: 'marriage', x1: a.x + SIZE / 2, y1: a.y, x2: b.x - SIZE / 2, y2: b.y, double: dbl });
  if (father && mother) marriage(father, mother, consParents);
  if (spouse) marriage(self, spouse, consSpouse);
  if (pgf && pgm) marriage(pgf, pgm, false);
  if (mgf && mgm) marriage(mgf, mgm, false);
  const descent = (parents: FamNode[], children: FamNode[]) => {
    if (parents.length === 0 || children.length === 0) return;
    const sy = parents[0].y;
    const cy = children[0].y;
    const mx = parents.length === 2 ? half(parents[0].x + parents[1].x) : parents[0].x;
    const fromY = parents.length === 2 ? sy : sy + SIZE / 2;
    const busY = sy + ROW / 2;
    lines.push({ kind: 'descent', x1: mx, y1: fromY, x2: mx, y2: busY, double: false });
    const lo = Math.min(mx, ...children.map((n) => n.x));
    const hi = Math.max(mx, ...children.map((n) => n.x));
    if (hi > lo) lines.push({ kind: 'descent', x1: lo, y1: busY, x2: hi, y2: busY, double: false });
    for (const c of children) lines.push({ kind: 'descent', x1: c.x, y1: busY, x2: c.x, y2: cy - SIZE / 2, double: false });
  };
  descent(pGrand, [...pSibs, ...(father ? [father] : [])]);
  descent(mGrand, [...(mother ? [mother] : []), ...mSibs]);
  descent([father, mother].filter((n): n is FamNode => !!n), sibship);
  descent([self, spouse].filter((n): n is FamNode => !!n), kids);
  return { nodes: ordered, lines, width, height };
}

/** The palette the printout uses for condition colours (same order as the server), so a symbol looks the same on screen and on paper. */
export const PALETTE = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

export interface FamCondition {
  key: string;
  label: string;
  color?: string;
}

export function colorOf(conditions: FamCondition[], key: string): string {
  const c = conditions.find((x) => x.key === key);
  if (c?.color) return c.color;
  const i = conditions.findIndex((x) => x.key === key);
  return i < 0 ? '#6b7280' : PALETTE[i % PALETTE.length];
}
