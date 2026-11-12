import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FieldDef } from '../../core/types';
import { examplesOf } from '../../testing/examples';
import { renderKind, unnamed, untouchable } from '../../testing/render-kind';
import { TestAssetStore } from '../../testing/test-assets';
import { totalConfig, totalLine, totalOf } from '../../narrative/combinations';
import { PICTURE_CHOICE_BUILD } from './pictureChoice.build';
import { PictureChoiceFill } from './pictureChoice.fill';
import { PictureChoicePanelComponent } from './pictureChoice.studio';
import { PictureChoiceMiniComponent } from './pictureChoice-mini.component';
import { FE_ASSETS } from '../../fill/contract';
import { KIND_SPECS } from '../registry';
import { kindControl } from '../../fill/contract';
import {
  addPart,
  alignPlaces,
  fit,
  freeSpot,
  MIN_PART,
  movePlace,
  pickedOf,
  pictureChoiceConfig,
  placeOf,
  resizePlace,
  safePath,
  setBoxConfig,
  setPartValue,
  setPicture,
  setTotal,
  toggled,
} from './pictureChoice-model';

const [limbs] = examplesOf('pictureChoice');
const field: FieldDef = limbs.field;
const settle = async (r: { stable(): Promise<void> }) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((res) => setTimeout(res));
    await r.stable();
  }
};

describe('pictureChoice model', () => {
  it('config defaults: several picks, square, names shown; aspect is kept in range', () => {
    expect(pictureChoiceConfig({})).toEqual({ multiple: true, aspect: 1, background: null, showLabels: true });
    expect(pictureChoiceConfig({ config: { multiple: false, aspect: 9, showLabels: false, background: 'a1' } })).toEqual({ multiple: false, aspect: 3, background: 'a1', showLabels: false });
  });

  it('a part with no place gets a tidy default inside the box; a stored place is kept inside the box', () => {
    for (let i = 0; i < 4; i++) {
      const p = placeOf({}, i, 4);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(1);
      expect(p.y + p.h).toBeLessThanOrEqual(1);
    }
    expect(placeOf({ place: { x: 0.9, y: 0.9, w: 0.4, h: 0.4 } })).toEqual({ x: 0.6, y: 0.6, w: 0.4, h: 0.4 });
    expect(fit({ x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: MIN_PART, h: MIN_PART });
  });

  it('moving snaps to the light grid and never leaves the box', () => {
    const p = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    expect(movePlace(p, 0.013, 0.0, true)).toEqual({ x: 0.125, y: 0.1, w: 0.3, h: 0.3 });
    expect(movePlace(p, 0.013, 0.0, false).x).toBeCloseTo(0.113, 3);
    expect(movePlace(p, 5, 5)).toEqual({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 });
    expect(movePlace(p, -5, -5)).toEqual({ x: 0, y: 0, w: 0.3, h: 0.3 });
  });

  it('a corner resizes while the opposite corner stays; never smaller than the minimum', () => {
    const p = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    expect(resizePlace(p, 'se', 0.1, 0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 });
    expect(resizePlace(p, 'nw', -0.1, -0.1)).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
    const tiny = resizePlace(p, 'se', -1, -1);
    expect(tiny.w).toBeCloseTo(MIN_PART, 4);
    expect(tiny.x).toBe(0.2);
    expect(resizePlace(p, 'se', 5, 5)).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
  });

  it('align lines the parts up on an edge or a centre', () => {
    const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const b = { x: 0.5, y: 0.6, w: 0.3, h: 0.1 };
    expect(alignPlaces([a, b], 'left').map((p) => p.x)).toEqual([0.1, 0.1]);
    expect(alignPlaces([a, b], 'right').map((p) => Math.round((p.x + p.w) * 100) / 100)).toEqual([0.8, 0.8]);
    expect(alignPlaces([a, b], 'top').map((p) => p.y)).toEqual([0.1, 0.1]);
    expect(alignPlaces([a], 'left')).toEqual([a]);
  });

  it('a tap toggles; the answer is always an array in the form\'s order; single choice keeps one', () => {
    expect(toggled(field, null, 'lh')).toEqual(['lh']);
    expect(toggled(field, ['lh'], 'rh')).toEqual(['rh', 'lh']);
    expect(toggled(field, ['rh', 'lh'], 'rh')).toEqual(['lh']);
    expect(toggled(field, ['rh'], 'rh')).toBeUndefined();
    const one = { ...field, config: { multiple: false } };
    expect(toggled(one, ['rh'], 'lh')).toEqual(['lh']);
    expect(pickedOf(one, ['rh', 'lh'])).toEqual(['rh']);
    expect(pickedOf(field, ['RH', 'rh'])).toEqual(['rh']);
  });

  it('adding a part: a unique key, a free place, optional picture; removing the picture clears both homes', () => {
    const f: FieldDef = structuredClone(field);
    const o = addPart(f, 'Rh');
    expect(o.key).toBe('rh_2');
    expect(f.options).toHaveLength(5);
    const taken = f.options!.slice(0, 4).map((x, i) => placeOf(x, i, 4));
    expect(taken.some((t) => Math.abs(t.x - o.place!.x) < 1e-9 && Math.abs(t.y - o.place!.y) < 1e-9)).toBe(false);
    setPicture(o, { drawn: 'M0,0 L10,10 Z' });
    expect(o.drawn).toBeTruthy();
    setPicture(o, { asset: 'a1' });
    expect(o.asset).toBe('a1');
    expect(o.drawn).toBeUndefined();
    setPicture(o, null);
    expect(o.asset ?? o.drawn).toBeUndefined();
    expect(freeSpot([{ x: 0, y: 0, w: 1, h: 1 }])).toEqual(fit({ x: 0.35, y: 0.35, w: 0.3, h: 0.3 }));
  });

  it('turning "more than one" off drops the combination sentences (they are for sets of picks)', () => {
    const f: FieldDef = structuredClone(field);
    f.says!.combinations = [{ id: 'c1', options: ['rh', 'lh'], match: 'exact', text: 'x' }];
    setBoxConfig(f, { multiple: false });
    expect(f.config!['multiple']).toBe(false);
    expect(f.says!.combinations).toBeUndefined();
  });

  it('drawn path data: only path letters, numbers and separators, bounded, starting with a move', () => {
    expect(safePath('M10,10 L20,20 Q5,5 6,6 T7,7 Z')).toBeTruthy();
    expect(safePath('<script>alert(1)</script>')).toBeNull();
    expect(safePath('M0,0 L1,1 url(x)')).toBeNull();
    expect(safePath('L1,1')).toBeNull();
    expect(safePath('M0,0 ' + '1 '.repeat(5000))).toBeNull();
    expect(safePath(5)).toBeNull();
  });
});

describe('pictureChoice fill', () => {
  it('is registered, loaded on first use (a heavy-ish kind), and has a Studio descriptor', async () => {
    expect(KIND_SPECS.pictureChoice).toBeDefined();
    expect(typeof (await kindControl(KIND_SPECS.pictureChoice))).toBe('function');
    expect(PICTURE_CHOICE_BUILD.panel).toBe(PictureChoicePanelComponent);
  });

  it.each(examplesOf('pictureChoice').map((e) => [e.name, e] as const))('renders the catalogue example "%s"', async (_n, ex) => {
    const r = await renderKind(PictureChoiceFill, ex.field, ex.answers[ex.field.key]);
    expect(untouchable(r.el)).toEqual([]);
    expect(unnamed(r.el)).toEqual([]);
  });

  it('parts are checkboxes named by their labels, laid out by their place; picked ones say so (check badge + aria-checked)', async () => {
    const r = await renderKind(PictureChoiceFill, field, ['lh']);
    const parts = [...r.el.querySelectorAll<HTMLElement>('.fe-pc__part')];
    expect(parts.map((p) => p.getAttribute('role'))).toEqual(['checkbox', 'checkbox', 'checkbox', 'checkbox']);
    expect(parts.map((p) => p.getAttribute('aria-label'))).toEqual(['Right hand', 'Left hand', 'Right leg', 'Left leg']);
    expect(parts.map((p) => p.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    expect(parts[1].classList.contains('fe-pc__part--on')).toBe(true);
    expect(parts[1].querySelector('.fe-pc__badge')).toBeTruthy();
    expect(parts[0].style.left).toBe('5%');
    expect(r.el.querySelectorAll('.fe-pc__label')).toHaveLength(4);
  });

  it('a tap writes the picked keys (array, form order); tapping again takes it back; nothing left = no answer', async () => {
    const r = await renderKind(PictureChoiceFill, field, null);
    await r.click('[data-option="lh"]');
    expect(r.last()).toEqual(['lh']);
    await r.click('[data-option="rh"]');
    expect(r.last()).toEqual(['rh', 'lh']);
    await r.click('[data-option="rh"]');
    await r.click('[data-option="lh"]');
    expect(r.last()).toBeUndefined();
  });

  it('single choice: radios, one pick at a time', async () => {
    const one = { ...field, config: { ...field.config, multiple: false } };
    const r = await renderKind(PictureChoiceFill, one, null);
    expect(r.el.querySelector('.fe-pc')?.getAttribute('role')).toBe('radiogroup');
    expect(r.el.querySelector('.fe-pc__part')?.getAttribute('role')).toBe('radio');
    await r.click('[data-option="rh"]');
    await r.click('[data-option="ll"]');
    expect(r.last()).toEqual(['ll']);
  });

  it('keyboard: a part is a button, Enter / Space toggles it (native); names can be hidden', async () => {
    const hidden = { ...field, config: { ...field.config, showLabels: false } };
    const r = await renderKind(PictureChoiceFill, hidden, null);
    expect(r.el.querySelectorAll('.fe-pc__label')).toHaveLength(0);
    expect(r.el.querySelector('.fe-pc__part')?.tagName).toBe('BUTTON');
  });

  it('disabled: no tap writes', async () => {
    const r = await renderKind(PictureChoiceFill, field, null);
    await r.setDisabled(true);
    await r.click('[data-option="rh"]');
    expect(r.calls).toEqual([]);
  });

  it('an uploaded picture shows through the host\'s store; a drawn one is a filled path; neither is a named tile', async () => {
    const assets = new TestAssetStore({ 'a-1': { width: 100, height: 100 } });
    const f: FieldDef = structuredClone(field);
    f.options![0].asset = 'a-1';
    f.options![1].drawn = 'M10,10 L90,10 L90,90 Z';
    const r = await renderKind(PictureChoiceFill, f, null, { assets });
    await settle(r);
    const parts = [...r.el.querySelectorAll('.fe-pc__part')];
    expect(parts[0].querySelector('img')?.getAttribute('src')).toBe('https://files.test/a-1');
    expect(parts[1].querySelector('svg path')?.getAttribute('d')).toBe('M10,10 L90,10 L90,90 Z');
    expect(parts[2].querySelector('.fe-pc__initial')?.textContent).toBe('R');
  });
});

describe('pictureChoice studio panel', () => {
  async function mount(f: FieldDef, assets: TestAssetStore | null = new TestAssetStore()) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: FE_ASSETS, useValue: assets }] });
    const fld = signal<FieldDef>(structuredClone(f));
    const edits: FieldDef[] = [];
    const fx = TestBed.createComponent(PictureChoicePanelComponent);
    fx.componentRef.setInput('field', fld());
    fx.componentRef.setInput('apply', (change: (x: FieldDef) => void) => {
      const next = structuredClone(fld());
      change(next);
      fld.set(next);
      edits.push(next);
      fx.componentRef.setInput('field', next);
    });
    fx.detectChanges();
    await fx.whenStable();
    const el = fx.nativeElement as HTMLElement;
    const stable = async () => {
      fx.detectChanges();
      await fx.whenStable();
      fx.detectChanges();
    };
    return { el, edits, fld, stable };
  }

  it('lists the parts in a layout box; "Add a part" adds one with its own place and selects it', async () => {
    const m = await mount(field);
    expect(m.el.querySelectorAll('.fe-pcl__part')).toHaveLength(4);
    (m.el.querySelector('[data-act="add-part"]') as HTMLElement).click();
    await m.stable();
    expect(m.fld().options).toHaveLength(5);
    expect(m.el.querySelector('[data-selected-part]')).toBeTruthy();
    expect(m.el.querySelector('.fe-pcl__h')).toBeTruthy();
  });

  it('tapping a part selects it; its picture buttons appear; upload stores the asset on that part', async () => {
    const assets = new TestAssetStore();
    const m = await mount(field, assets);
    (m.el.querySelector('[data-part="lh"]') as HTMLElement).dispatchEvent(new FocusEvent('focus'));
    await m.stable();
    expect(m.el.querySelector('[data-selected-part] .fe-pcp__name')?.textContent).toBe('Left hand');
    const input = m.el.querySelector<HTMLInputElement>('[data-part-input]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'hand.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    await settle(m);
    expect(assets.uploads).toEqual([{ kind: 'template', type: 'image/png' }]);
    expect(m.fld().options!.find((o) => o.key === 'lh')!.asset).toBeTruthy();
  });

  it('a drag moves one part and is ONE edit; the others keep their places', async () => {
    const m = await mount(field);
    const box = m.el.querySelector<HTMLElement>('[data-layout]')!;
    box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const part = m.el.querySelector<HTMLElement>('[data-part="rh"]')!;
    const ev = (t: string, x: number, y: number) => Object.assign(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y }), { pointerId: 1 });
    part.dispatchEvent(ev('pointerdown', 20, 20));
    part.dispatchEvent(ev('pointermove', 60, 40));
    part.dispatchEvent(ev('pointerup', 60, 40));
    await m.stable();
    expect(m.edits).toHaveLength(1);
    const placed = m.fld().options!.find((o) => o.key === 'rh')!.place!;
    expect(placed.x).toBeCloseTo(0.25, 2);
    expect(placed.y).toBeCloseTo(0.15, 2);
    expect(m.fld().options!.find((o) => o.key === 'll')!.place).toBeDefined();
  });

  it('the box settings: one pick instead of several; names hidden', async () => {
    const m = await mount(field);
    (m.el.querySelector('[data-act="multiple"]') as HTMLElement).click();
    await m.stable();
    expect(m.fld().config!['multiple']).toBe(false);
    (m.el.querySelector('[data-act="labels"]') as HTMLElement).click();
    await m.stable();
    expect(m.fld().config!['showLabels']).toBe(false);
  });

  it('arrow keys nudge the focused part by one grid step; Shift resizes', async () => {
    const m = await mount(field);
    const part = m.el.querySelector<HTMLElement>('[data-part="rh"]')!;
    part.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await m.stable();
    expect(m.fld().options!.find((o) => o.key === 'rh')!.place!.x).toBeCloseTo(0.075, 3);
  });

  it('the small tap box toggles a part by key', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: FE_ASSETS, useValue: null }] });
    const fx = TestBed.createComponent(PictureChoiceMiniComponent);
    const picks: string[] = [];
    fx.componentRef.setInput('field', field);
    fx.componentRef.setInput('picked', ['rh']);
    fx.componentInstance.pick.subscribe((k) => picks.push(k));
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-option="rh"]')?.getAttribute('aria-checked')).toBe('true');
    (el.querySelector('[data-option="ll"]') as HTMLElement).click();
    expect(picks).toEqual(['ll']);
  });
});

describe('pictureChoice total (burns chart)', () => {
  const burns: FieldDef = {
    key: 'burn',
    kind: 'pictureChoice',
    label: 'Burnt areas',
    config: { multiple: true, aspect: 0.6, total: { label: 'Total burn area', unit: '%', decimals: 1 } },
    options: [
      { key: 'head', label: 'Head', value: 9, subFields: [] },
      { key: 'arm', label: 'Right arm', value: 4.5, subFields: [] },
      { key: 'leg', label: 'Left leg', value: 18, subFields: [] },
      { key: 'none', label: 'Note', subFields: [] },
    ],
  };

  it('adds the picked parts\' numbers; a part with no number adds nothing; no total configured = no line', () => {
    expect(totalOf(burns, ['head', 'arm'])).toBe(13.5);
    expect(totalOf(burns, ['none'])).toBe(0);
    expect(totalLine(burns, ['head', 'leg'])).toBe('Total burn area 27%');
    expect(totalLine(burns, ['head', 'arm'])).toBe('Total burn area 13.5%');
    expect(totalLine(burns, [])).toBeNull(); // nothing picked = no total
    expect(totalLine({ ...burns, config: { multiple: true } }, ['head'])).toBeNull();
    expect(totalConfig({ config: { total: { decimals: 9 } } })).toEqual({ label: 'Total', unit: '', decimals: 4 });
  });

  it('fill shows the live total under the picture and updates with each tap', async () => {
    const r = await renderKind(PictureChoiceFill, burns, null);
    expect(r.el.querySelector('[data-total]')).toBeNull();
    await r.click('[data-option="head"]');
    await r.click('[data-option="leg"]');
    expect(r.el.querySelector('[data-total]')?.textContent?.trim()).toBe('Total burn area 27%');
  });

  it('a question without a total shows no line', async () => {
    const r = await renderKind(PictureChoiceFill, field, ['rh']);
    expect(r.el.querySelector('[data-total]')).toBeNull();
  });

  it('Studio: switch the total on, name it, give a part its number', () => {
    const f: FieldDef = structuredClone(field);
    setTotal(f, {});
    expect(totalConfig(f)).toEqual({ label: 'Total', unit: '', decimals: 0 });
    setTotal(f, { label: 'Total burn area', unit: '%' });
    expect(totalConfig(f)).toEqual({ label: 'Total burn area', unit: '%', decimals: 0 });
    setPartValue(f.options![0], '4,5');
    expect(f.options![0].value).toBe(4.5);
    setPartValue(f.options![0], '');
    expect(f.options![0].value).toBeUndefined();
    setTotal(f, null);
    expect(totalConfig(f)).toBeNull();
  });
});
