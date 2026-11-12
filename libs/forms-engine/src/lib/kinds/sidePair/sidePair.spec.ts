import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ApplyFieldChange } from '../../build/contract';
import { emptyDefinition, newField } from '../../build/doc';
import { FieldDef } from '../../core/types';
import { FE_KINDS } from '../../fill/contract';
import { examplesOf } from '../../testing/examples';
import { f, renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { KIND_SPECS } from '../registry';
import { kindBuild } from '../build-registry';
import { writeShorthand } from '../shorthand/shorthand-math';
import { SidePairFill } from './sidePair.fill';
import { SidePairPanelComponent } from './sidePair.studio';
import { onlySide, pairAnswered, pairWords, sideLabels, sideOrder, sideValue, withSide } from './side-pair-model';

const words = (inner: FieldDef, v: unknown): string => {
  if (inner.kind === 'shorthand') return writeShorthand(String(inner.config?.['preset']), v as Record<string, unknown>);
  if (inner.kind === 'number') return `${v} ${inner.config?.['unit'] ?? ''}`.trim();
  if (inner.kind === 'choice') return inner.options?.find((o) => o.key === v)?.says ?? String(v);
  return String(v);
};

const va = (extra: Record<string, unknown> = {}): FieldDef => ({
  key: 'vision',
  kind: 'sidePair',
  label: 'Vision',
  config: { sideWords: 'eyes', ...extra },
  children: [{ key: 'vaEach', kind: 'shorthand', label: 'Vision', config: { preset: 'visualAcuity' } }],
});

describe('side pair model', () => {
  it('side words: right and left by default, RE / LE for eyes, R ear / L ear for ears, or the author\'s own', () => {
    expect(sideLabels(undefined)).toEqual({ right: 'Right', left: 'Left' });
    expect(sideLabels({ sideWords: 'eyes' })).toEqual({ right: 'RE', left: 'LE' });
    expect(sideLabels({ sideWords: 'ears' })).toEqual({ right: 'R ear', left: 'L ear' });
    expect(sideLabels({ sideWords: 'eyes', rightLabel: ' Dominant ', leftLabel: '' })).toEqual({ right: 'Dominant', left: 'LE' });
  });

  it('right first unless the field says left first', () => {
    expect(sideOrder({})).toEqual(['right', 'left']);
    expect(sideOrder({ order: 'leftFirst' })).toEqual(['left', 'right']);
  });

  it('a blank side is left out; nothing left is no answer', () => {
    expect(withSide(undefined, 'right', 5)).toEqual({ right: 5 });
    expect(withSide({ right: 5 }, 'left', 7)).toEqual({ right: 5, left: 7 });
    expect(withSide({ right: 5, left: 7 }, 'right', undefined)).toEqual({ left: 7 });
    expect(withSide({ right: 5 }, 'right', {})).toBeUndefined();
    expect(withSide({ right: 5 }, 'left', '')).toEqual({ right: 5 });
    expect(sideValue({ right: [] }, 'right')).toBeUndefined();
  });

  it('answered when either side holds something; which single side is answered', () => {
    expect(pairAnswered(undefined)).toBe(false);
    expect(pairAnswered({ right: {}, left: null })).toBe(false);
    expect(pairAnswered({ left: 'x' })).toBe(true);
    expect(onlySide({ left: 'x' })).toBe('left');
    expect(onlySide({ right: 'x' })).toBe('right');
    expect(onlySide({ right: 'x', left: 'y' })).toBeNull();
    expect(onlySide(undefined)).toBeNull();
  });

  describe('the words it writes (the same cases as the server goldens)', () => {
    const cases: [string, FieldDef, unknown, string][] = [
      ['each side', va(), { right: { distance: '6/9', pinhole: '6/6', near: 'N6' }, left: { distance: '6/12', near: 'N8' } }, 'RE 6/9 (PH 6/6), N6, LE 6/12, N8'],
      ['equal sides are bilateral', va(), { right: { distance: '6/9' }, left: { distance: '6/9' } }, 'Bilateral 6/9'],
      ['bilateral switched off', va({ bilateral: false }), { right: { distance: '6/9' }, left: { distance: '6/9' } }, 'RE 6/9, LE 6/9'],
      ['only the right', va(), { right: { distance: '6/9' } }, 'RE 6/9'],
      ['only the left', va(), { left: { distance: '6/12' } }, 'LE 6/12'],
      ['nothing', va(), { right: {}, left: null }, ''],
      ['left first', va({ sideWords: 'rightLeft', order: 'leftFirst' }), { right: { distance: '6/6' }, left: { distance: '6/9' } }, 'Left 6/9, Right 6/6'],
      ['own words', va({ rightLabel: 'Dominant', leftLabel: 'Other' }), { right: { distance: '6/6' }, left: { distance: '6/9' } }, 'Dominant 6/6, Other 6/9'],
    ];
    it.each(cases)('%s', (_n, field, value, expected) => {
      expect(pairWords(field, value, words)).toBe(expected);
    });

    it('sides that differ only in capitals are the same', () => {
      const field: FieldDef = { key: 'p', kind: 'sidePair', label: 'P', config: {}, children: [{ key: 'n', kind: 'text', label: 'N' }] };
      expect(pairWords(field, { right: 'Normal', left: 'normal' }, words)).toBe('Bilateral Normal');
    });
  });
});

describe('side pair fill', () => {
  it.each(examplesOf('sidePair').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(SidePairFill, ex.field, ex.answers[ex.field.key]);
    expect(r.el.querySelectorAll('[data-side]').length).toBe(2);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('shows the two sides in order, each named by its side word', async () => {
    const r = await renderKind(SidePairFill, va(), null);
    const sides = [...r.el.querySelectorAll('[data-side]')];
    expect(sides.map((s) => s.getAttribute('data-side'))).toEqual(['right', 'left']);
    expect(sides.map((s) => s.getAttribute('aria-label'))).toEqual(['RE', 'LE']);
    expect(sides.map((s) => s.querySelector('.fe-field__lbl')?.textContent?.trim())).toEqual(['RE', 'LE']);
    const left = await renderKind(SidePairFill, va({ order: 'leftFirst' }), null);
    expect([...left.el.querySelectorAll('[data-side]')].map((s) => s.getAttribute('data-side'))).toEqual(['left', 'right']);
  });

  it('each side writes its own part of the answer', async () => {
    const r = await renderKind(SidePairFill, va(), null);
    await r.click('[data-side="right"] [data-box="distance"] [data-option="6/9"]');
    expect(r.last()).toEqual({ right: { distance: '6/9' } });
    await r.click('[data-side="left"] [data-box="distance"] [data-option="6/12"]');
    expect(r.last()).toEqual({ right: { distance: '6/9' }, left: { distance: '6/12' } });
    await r.click('[data-side="right"] [data-box="distance"] [data-option="6/9"]');
    expect(r.last()).toEqual({ left: { distance: '6/12' } });
  });

  it('"Same on both sides" appears when one side is answered and copies it across', async () => {
    const r = await renderKind(SidePairFill, va(), { right: { distance: '6/9', near: 'N6' } });
    await r.click('[data-same]');
    expect(r.last()).toEqual({ right: { distance: '6/9', near: 'N6' }, left: { distance: '6/9', near: 'N6' } });
    await r.stable();
    expect(r.el.querySelector('[data-same]')).toBeNull();
  });

  it('no copy button before anything is answered', async () => {
    const r = await renderKind(SidePairFill, va(), null);
    expect(r.el.querySelector('[data-same]')).toBeNull();
  });

  it('works with a choice and with a number', async () => {
    const choice = examplesOf('sidePair').find((e) => e.name === 'a finding in each ear')!;
    const r = await renderKind(SidePairFill, choice.field, null);
    await r.click('[data-side="right"] [data-option="perforated"]');
    expect(r.last()).toEqual({ right: 'perforated' });
    const pulse = examplesOf('sidePair').find((e) => e.name === 'pulse each side')!;
    const p = await renderKind(SidePairFill, pulse.field, null);
    expect([...p.el.querySelectorAll('[data-side]')].map((s) => s.getAttribute('data-side'))).toEqual(['left', 'right']);
  });

  it('a pair with no question says so instead of breaking', async () => {
    const r = await renderKind(SidePairFill, f('p', 'sidePair', { label: 'P', config: {}, children: [] }), null);
    expect(r.el.textContent).toContain('nothing to ask');
  });

  it('disabled: both sides are locked and nothing is written', async () => {
    const r = await renderKind(SidePairFill, va(), { right: { distance: '6/9' } });
    await r.setDisabled(true);
    for (const b of r.buttons()) expect(b.disabled).toBe(true);
    expect(r.calls).toEqual([]);
  });

  it('the pair and its inner question are registered like any kind', () => {
    expect(KIND_SPECS.sidePair.component).toBe(SidePairFill);
    expect(kindBuild('sidePair').name).toBe('Left and right');
    expect(kindBuild('shorthand').name).toBe('Clinical shorthand');
  });
});

@Component({
  standalone: true,
  imports: [SidePairPanelComponent],
  template: `<fe-side-pair-panel [field]="field()" [apply]="apply" />`,
})
class Host {
  readonly field = signal<FieldDef>(newField(emptyDefinition('t'), 'sidePair'));
  readonly apply: ApplyFieldChange = (change) => {
    const draft = structuredClone(this.field());
    change(draft);
    this.field.set(draft);
  };
}


describe('side pair in Studio', () => {
  it('a new pair starts with one text question inside, keyed apart from the pair', () => {
    const def = emptyDefinition('t');
    const field = newField(def, 'sidePair');
    expect(field.children).toHaveLength(1);
    expect(field.children![0].kind).toBe('text');
    expect(field.children![0].key).not.toBe(field.key);
    expect(field.config).toMatchObject({ sideWords: 'rightLeft', order: 'rightFirst', bilateral: true });
  });

  it('a new shorthand starts as the obstetric score with every switch showing what it does', () => {
    const field = newField(emptyDefinition('t'), 'shorthand');
    expect(field.config).toMatchObject({ preset: 'obstetricScore', deaths: false, lmp: true, near: true, pinhole: true, glasses: true, add: true });
  });

  it('the sample answer has both sides', () => {
    const sample = kindBuild('sidePair').sample(va()) as { right: unknown; left: unknown };
    expect(sample.right).toEqual({ distance: '6/9', near: 'N6' });
    expect(sample.left).toEqual(sample.right);
    expect(kindBuild('shorthand').sample({ key: 'x', kind: 'shorthand', label: 'x', config: { preset: 'musclePower' } })).toEqual({ grade: 4 });
  });

  it('shorthand settings only show the ones that belong to the chosen notation', () => {
    const rows = (preset: string) =>
      kindBuild('shorthand')
        .config.filter((c) => !c.when || c.when({ key: 'x', kind: 'shorthand', label: 'x', config: { preset } }))
        .map((c) => c.name);
    expect(rows('obstetricScore')).toEqual(['preset', 'deaths']);
    expect(rows('menstrual')).toEqual(['preset', 'lmp']);
    expect(rows('visualAcuity')).toEqual(['preset', 'near', 'pinhole', 'glasses']);
    expect(rows('refraction')).toEqual(['preset', 'add']);
    expect(rows('musclePower')).toEqual(['preset']);
  });

  async function panel() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: FE_KINDS, useValue: KIND_SPECS }] });
    const fx = TestBed.createComponent(Host);
    fx.detectChanges();
    await fx.whenStable();
    const cmp = fx.debugElement.query(By.directive(SidePairPanelComponent)).componentInstance as Record<string, (...a: unknown[]) => void>;
    const stable = async () => {
      fx.detectChanges();
      await fx.whenStable();
      fx.detectChanges();
    };
    return { fx, host: fx.componentInstance, cmp, el: fx.nativeElement as HTMLElement, stable };
  }

  it('changing the question keeps its key and gives it what it needs (choices)', async () => {
    const { host, cmp, stable } = await panel();
    const key = host.field().children![0].key;
    cmp['setKind']('choice');
    await stable();
    const c = host.field().children![0];
    expect(c.key).toBe(key);
    expect(c.kind).toBe('choice');
    expect(c.options!.map((o) => o.label)).toEqual(['First choice', 'Second choice']);
    expect(host.field().children).toHaveLength(1);
  });

  it('choices can be renamed, added and removed', async () => {
    const { host, cmp, el, stable } = await panel();
    cmp['setKind']('choice');
    await stable();
    expect(el.querySelectorAll('[data-sp="choices"] .sp-choice').length).toBe(2);
    cmp['renameChoice']('first', 'Intact');
    const input = el.querySelector<HTMLInputElement>('[aria-label="New choice"]')!;
    input.value = 'Perforated';
    input.dispatchEvent(new Event('input'));
    await stable();
    (el.querySelector('.sp-add .pf-btn') as HTMLElement).click();
    await stable();
    expect(host.field().children![0].options!.map((o) => [o.key, o.label])).toEqual([
      ['first', 'Intact'],
      ['second', 'Second choice'],
      ['perforated', 'Perforated'],
    ]);
    cmp['removeChoice']('second');
    await stable();
    expect(host.field().children![0].options!.map((o) => o.key)).toEqual(['first', 'perforated']);
  });

  it('a measurement takes a unit and limits; a shorthand takes a notation', async () => {
    const { host, cmp, el, stable } = await panel();
    cmp['setKind']('measure');
    await stable();
    expect(el.querySelectorAll('[data-sp="numbers"] input').length).toBe(3);
    cmp['setConfig']('unit', 'mmHg');
    cmp['setNumber']('max', '260');
    await stable();
    expect(host.field().children![0].config).toMatchObject({ unit: 'mmHg', max: 260 });
    cmp['setKind']('shorthand');
    await stable();
    cmp['setPreset']('refraction');
    await stable();
    expect(host.field().children![0].config).toMatchObject({ preset: 'refraction', add: true });
    expect(el.querySelector('[data-sp="preset"]')).not.toBeNull();
  });

  it('only the kinds a pair can ask are offered', async () => {
    const { el } = await panel();
    expect(el.querySelector('[data-sp="kind"] pf-select')).not.toBeNull();
    expect(kindBuild('sidePair').panel).toBe(SidePairPanelComponent);
  });
});
