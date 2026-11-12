import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { FamilyTreeFill } from './familyTree.fill';
import { buildLayout } from './family-layout';

const field = () => f('family', 'familyTree', { label: 'Family history', config: { conditions: [{ key: 'diabetes', label: 'Diabetes' }, { key: 'hypertension', label: 'Hypertension' }] } });

describe('pedigree layout', () => {
  it('puts parents over the patient, centres the sibship and numbers in reading order', () => {
    const l = buildLayout({ self: { sex: 'male' }, people: [{ relation: 'father' }, { relation: 'mother' }, { relation: 'brother' }] });
    const by = (r: string) => l.nodes.find((n) => n.relation === r)!;
    const self = l.nodes.find((n) => n.proband)!;
    expect(by('father').y).toBeLessThan(self.y);
    expect((by('father').x + by('mother').x) / 2).toBe((by('brother').x + self.x) / 2);
    expect(l.nodes.map((n) => n.number)).toEqual([1, 2, 3, 4]);
    expect(by('father').shape).toBe('square');
    expect(by('mother').shape).toBe('circle');
  });
  it('a second father is ignored and the spouse takes the opposite sex when none is given', () => {
    const l = buildLayout({ self: { sex: 'male' }, people: [{ relation: 'father' }, { relation: 'father' }, { relation: 'spouse' }] });
    expect(l.nodes.filter((n) => n.relation === 'father')).toHaveLength(1);
    expect(l.nodes.find((n) => n.relation === 'spouse')!.shape).toBe('circle');
  });
  it('blood relative parents get a double marriage line', () => {
    const l = buildLayout({ people: [{ relation: 'father' }, { relation: 'mother' }], consanguinity: { parents: true } });
    expect(l.lines.some((x) => x.kind === 'marriage' && x.double)).toBe(true);
  });
});

describe('familyTree fill', () => {
  it.each(examplesOf('familyTree').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(FamilyTreeFill, ex.field, ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
    expect(r.el.querySelectorAll('[data-node]').length).toBeGreaterThan(1);
  });

  it('draws the patient alone at first and adds relatives from the free relations', async () => {
    const r = await renderKind(FamilyTreeFill, field());
    expect(r.el.querySelectorAll('[data-node]')).toHaveLength(1);
    const c = r.instance(FamilyTreeFill) as unknown as { addRelative(x: string): void; freeRelations(): { value: string }[] };
    expect(c.freeRelations().map((o) => o.value)).toContain('father');
    c.addRelative('father');
    await r.stable();
    expect(r.last()).toEqual({ people: [{ relation: 'father' }] });
    expect(r.el.querySelectorAll('[data-node]')).toHaveLength(2);
    expect(c.freeRelations().map((o) => o.value)).not.toContain('father');
    expect(c.freeRelations().map((o) => o.value)).toContain('brother'); // brothers can repeat
  });

  it('marks a condition (filled symbol), that the person has died, and blood relative parents', async () => {
    const r = await renderKind(FamilyTreeFill, field(), { people: [{ relation: 'father' }, { relation: 'mother' }] });
    await r.click('[data-person="p0"] .fe-fam__open');
    await r.click('[data-person="p0"] [data-cond="diabetes"]');
    expect(r.last()).toEqual({ people: [{ relation: 'father', conditions: ['diabetes'] }, { relation: 'mother' }] });
    expect(r.el.querySelector('[data-node="p0"] clipPath')).not.toBeNull();
    await r.click('[data-person="p0"] [data-act="deceased"]');
    expect((r.last() as { people: { deceased?: boolean }[] }).people[0].deceased).toBe(true);
    expect(r.el.querySelector('[data-node="p0"] .fe-ped__slash')).not.toBeNull();
    const age = r.el.querySelector<HTMLInputElement>('[data-person="p0"] [data-f="ageAtDeath"]')!;
    age.value = '55';
    age.dispatchEvent(new Event('change', { bubbles: true }));
    await r.stable();
    expect((r.last() as { people: { ageAtDeath?: number }[] }).people[0].ageAtDeath).toBe(55);
    await r.click('[data-act="cons-parents"]');
    expect((r.last() as { consanguinity: { parents: boolean } }).consanguinity).toEqual({ parents: true });
  });

  it('shows the blood-relatives switches only when they make sense', async () => {
    const r = await renderKind(FamilyTreeFill, field(), { people: [{ relation: 'brother' }] });
    expect(r.el.querySelector('[data-act="cons-parents"]')).toBeNull();
    expect(r.el.querySelector('[data-act="cons-spouse"]')).toBeNull();
    await r.setValue({ people: [{ relation: 'spouse' }] });
    expect(r.el.querySelector('[data-act="cons-spouse"]')).not.toBeNull();
  });

  it('"No significant family history" is an answer on its own and clears when switched off', async () => {
    const r = await renderKind(FamilyTreeFill, field());
    await r.click('[data-act="no-history"]');
    expect(r.last()).toEqual({ noHistory: true });
    await r.click('[data-act="no-history"]');
    expect(r.last()).toBeUndefined();
  });

  it('removing a person asks first (the kit dialog, never window.confirm)', async () => {
    const asked: string[] = [];
    const r = await renderKind(FamilyTreeFill, field(), { people: [{ relation: 'father' }, { relation: 'mother' }] }, {
      dialog: { confirm: (req) => (asked.push(req.title), Promise.resolve(true)) },
    });
    await r.click('[data-person="p0"] .fe-fam__open');
    await r.click('[data-person="p0"] [data-act="remove"]');
    await r.stable();
    expect(asked).toEqual(['Remove father?']);
    expect(r.last()).toEqual({ people: [{ relation: 'mother' }] });
  });

  it('the patient: sex and conditions', async () => {
    const r = await renderKind(FamilyTreeFill, field());
    await r.click('[data-person="self"] .fe-fam__open');
    await r.click('[data-person="self"] [data-sex="female"]');
    await r.click('[data-person="self"] [data-cond="diabetes"]');
    expect(r.last()).toEqual({ self: { sex: 'female', conditions: ['diabetes'] } });
    expect(r.el.querySelector('[data-node="self"] circle.fe-ped__shape')).not.toBeNull();
  });
});
