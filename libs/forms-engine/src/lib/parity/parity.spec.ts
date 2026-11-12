import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { chronological, durationWeight, visibleFields, wizardPages } from '../core/pages';
import { lookupIn, resizeInstances } from '../core/rules';
import { FieldDef, FormDefinition } from '../core/types';
import { FE_KINDS, FieldSuggestion, SuggestionSource } from '../fill/contract';
import { FieldHostComponent, laterKind } from '../fill/field-host.component';
import { HoldDirective } from '../fill/hold.directive';
import { bmiCategory } from '../kinds/bmi/bmi.fill';
import { ChoiceFill } from '../kinds/choice/choice.fill';
import { MultiFill } from '../kinds/multi/multi.fill';
import { NumberFill } from '../kinds/number/number.fill';
import { KIND_SPECS } from '../kinds/registry';
import { RepeatPagesFill } from '../kinds/repeatPages/repeatPages.fill';
import { SUGGESTION_DEBOUNCE_MS, TextFill } from '../kinds/text/text.fill';
import { narratePicks, picksWords, pickedKeys } from '../narrative/combinations';
import combos from '../testing/casesheet-combinations.vectors.json';
import { f, renderKind, untouchable } from '../testing/render-kind';

/**
 * Legacy parity (pf-work/plans/prepare-parity.md): holds, suggestions, option descriptions, BMI band,
 * the form's own error words, locked fields, kinds that come later, chronological pages, arranged repetitions.
 */

// ───────────────────────── A: press-and-hold ─────────────────────────
@Component({
  standalone: true,
  imports: [HoldDirective],
  template: `<button type="button" feHold [holdDelay]="300" [holdMs]="1500" [holdCancelSwallowsTap]="strict" (feHold)="held = held + 1" (click)="taps = taps + 1">Next</button>`,
})
class HoldHost {
  held = 0;
  taps = 0;
  strict = false;
}

function pointer(el: Element, type: string, x = 10, y = 10): void {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }) as unknown as PointerEvent;
  el.dispatchEvent(e);
}

describe('press-and-hold (A1–A5)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setup() {
    TestBed.resetTestingModule();
    const fx = TestBed.createComponent(HoldHost);
    fx.detectChanges();
    return { fx, btn: fx.nativeElement.querySelector('button') as HTMLButtonElement };
  }

  it('a still press of delay + fill fires once, marks the button while it runs, and swallows the click after', async () => {
    const { fx, btn } = await setup();
    pointer(btn, 'pointerdown');
    vi.advanceTimersByTime(299);
    expect(btn.hasAttribute('data-holding')).toBe(false);
    vi.advanceTimersByTime(2);
    expect(btn.hasAttribute('data-holding')).toBe(true);
    expect(fx.componentInstance.held).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(fx.componentInstance.held).toBe(1);
    expect(btn.hasAttribute('data-holding')).toBe(false);
    pointer(btn, 'pointerup');
    btn.click();
    expect(fx.componentInstance.taps).toBe(0); // the hold already acted
    vi.advanceTimersByTime(700);
    pointer(btn, 'pointerdown');
    pointer(btn, 'pointerup');
    btn.click();
    expect(fx.componentInstance.taps).toBe(1); // a later tap is a tap again
  });

  it('keeping the finger down long after the hold fired still never taps (legacy holdTriggered)', async () => {
    const { fx, btn } = await setup();
    pointer(btn, 'pointerdown');
    vi.advanceTimersByTime(1801);
    expect(fx.componentInstance.held).toBe(1);
    vi.advanceTimersByTime(2500); // still holding, well past the fire
    pointer(btn, 'pointerup');
    btn.click();
    expect(fx.componentInstance.taps).toBe(0);
  });

  it('a quick tap is only a tap', async () => {
    const { fx, btn } = await setup();
    pointer(btn, 'pointerdown');
    vi.advanceTimersByTime(120);
    pointer(btn, 'pointerup');
    btn.click();
    vi.advanceTimersByTime(3000);
    expect(fx.componentInstance.held).toBe(0);
    expect(fx.componentInstance.taps).toBe(1);
  });

  it('letting go during the fill: a tap by default (legacy Next), nothing when the hold owns the button (legacy PF logo)', async () => {
    const { fx, btn } = await setup();
    pointer(btn, 'pointerdown');
    vi.advanceTimersByTime(900);
    pointer(btn, 'pointerup');
    btn.click();
    expect(fx.componentInstance.taps).toBe(1);
    fx.componentInstance.strict = true;
    fx.detectChanges();
    pointer(btn, 'pointerdown');
    vi.advanceTimersByTime(900);
    pointer(btn, 'pointerup');
    btn.click();
    expect(fx.componentInstance.taps).toBe(1);
    expect(fx.componentInstance.held).toBe(0);
    pointer(btn, 'pointerdown');
    vi.advanceTimersByTime(100);
    pointer(btn, 'pointerup');
    btn.click();
    expect(fx.componentInstance.taps).toBe(2); // a quick tap still taps
  });

  it('letting go during the fill cancels; moving (a scroll) cancels', async () => {
    const { fx, btn } = await setup();
    pointer(btn, 'pointerdown');
    vi.advanceTimersByTime(900);
    pointer(btn, 'pointerup');
    vi.advanceTimersByTime(3000);
    expect(fx.componentInstance.held).toBe(0);
    pointer(btn, 'pointerdown', 10, 10);
    vi.advanceTimersByTime(100);
    pointer(btn, 'pointermove', 10, 40);
    vi.advanceTimersByTime(3000);
    expect(fx.componentInstance.held).toBe(0);
  });
});

// ───────────────────────── F: suggestions ─────────────────────────
function source(rows: FieldSuggestion[]) {
  const calls: { field: string; q?: string }[] = [];
  const removed: string[] = [];
  const src: SuggestionSource = {
    list: async (field, q) => {
      calls.push({ field, q });
      const t = q?.toLowerCase() ?? '';
      return rows.filter((r) => !removed.includes(r.id) && r.text.toLowerCase().includes(t));
    },
    remove: async (_field, id) => {
      removed.push(id);
    },
  };
  return { src, calls, removed };
}

const ROWS: FieldSuggestion[] = [
  { id: 'a', text: 'Worse at night' },
  { id: 'b', text: 'Worse on lying down' },
  { id: 'c', text: 'Better with steam inhalation and saline drops, used three times a day' },
];
const box = (el: HTMLElement) => el.querySelector<HTMLInputElement | HTMLTextAreaElement>('.fe-text__input')!;
const chips = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.fe-sugg__chip')];

describe('suggestion chips (F1–F7, B3)', () => {
  it('the top wording shows as chips above an empty line; a tap uses one', async () => {
    const { src } = source(ROWS);
    const r = await renderKind(TextFill, f('aggr', 'text', { label: 'Worse with' }), null, { suggestions: src });
    await r.stable();
    expect(chips(r.el).map((c) => c.textContent?.trim())).toEqual(ROWS.map((x) => x.text));
    expect(untouchable(r.el)).toEqual([]);
    await r.click(chips(r.el)[0]);
    expect(r.last()).toBe('Worse at night');
    // a filled line hides the chips (the matching rows take over while typing)
    expect(chips(r.el)).toEqual([]);
  });

  it('on a note, a chip ADDS the words (legacy voice-text chips appended)', async () => {
    const { src } = source(ROWS);
    const r = await renderKind(TextFill, f('notes', 'text', { config: { multiline: true } }), 'Nasal block.', {
      suggestions: src,
    });
    await r.stable();
    await r.click(chips(r.el)[1]);
    expect(r.last()).toBe('Nasal block. Worse on lying down');
  });

  it('typing shows matching earlier words under the line; ↓ Enter picks one, Esc hides them', async () => {
    vi.useFakeTimers();
    try {
      const { src, calls } = source(ROWS);
      const r = await renderKind(TextFill, f('aggr', 'text'), null, { suggestions: src });
      const i = box(r.el);
      i.dispatchEvent(new Event('focus'));
      i.value = 'worse';
      i.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(SUGGESTION_DEBOUNCE_MS + 5);
      await r.stable();
      const rows = [...r.el.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      expect(rows.map((x) => x.textContent?.trim())).toEqual(['Worse at night', 'Worse on lying down']);
      expect(calls.at(-1)).toEqual({ field: 'aggr', q: 'worse' });
      expect(i.getAttribute('aria-expanded')).toBe('true');
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      await r.stable();
      expect(i.getAttribute('aria-activedescendant')).toMatch(/-1$/);
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await r.stable();
      expect(r.last()).toBe('Worse on lying down');
      expect(r.el.querySelectorAll('[role="option"]').length).toBe(0);
      // Esc
      i.value = 'worse';
      i.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(SUGGESTION_DEBOUNCE_MS + 5);
      await r.stable();
      expect(r.el.querySelectorAll('[role="option"]').length).toBe(2);
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await r.stable();
      expect(r.el.querySelectorAll('[role="option"]').length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hold a chip: the whole text in a dialog — "Use this" or "Remove from my suggestions"', async () => {
    const { src, removed } = source(ROWS);
    const asked: { message?: string }[] = [];
    let answer = 'remove';
    const dialog = {
      actions: async (req: { message?: string }) => {
        asked.push(req);
        return { action: answer, checked: false };
      },
    };
    const r = await renderKind(TextFill, f('aggr', 'text'), null, { suggestions: src, dialog: dialog as never });
    await r.stable();
    // the directive's output, as a finger would trigger it
    chips(r.el)[2].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
    await new Promise((res) => setTimeout(res, 520));
    await r.stable();
    expect(asked[0].message).toBe(ROWS[2].text);
    expect(removed).toEqual(['c']);
    expect(chips(r.el).map((c) => c.textContent?.trim())).not.toContain(ROWS[2].text);
    answer = 'use';
    chips(r.el)[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
    await new Promise((res) => setTimeout(res, 520));
    await r.stable();
    expect(r.last()).toBe('Worse at night');
  });

  it('never on phone / e-mail fields, never when the form turned them off, and offline is silent', async () => {
    const { src, calls } = source(ROWS);
    const phone = await renderKind(TextFill, f('ph', 'text', { config: { format: 'phone' } }), null, { suggestions: src });
    await phone.stable();
    expect(chips(phone.el)).toEqual([]);
    const off = await renderKind(TextFill, f('q', 'text', { config: { suggestions: false } }), null, { suggestions: src });
    await off.stable();
    expect(chips(off.el)).toEqual([]);
    expect(calls).toEqual([]);
    const broken: SuggestionSource = { list: () => Promise.reject(new Error('offline')), remove: async () => undefined };
    const r = await renderKind(TextFill, f('x', 'text'), null, { suggestions: broken });
    await r.stable();
    expect(chips(r.el)).toEqual([]);
    expect(r.el.querySelector('.fe-field__err')).toBeNull();
  });
});

// ───────────────────────── C8 / C9: the form's own words for limits ─────────────────────────
describe('limits in the form’s words (C8, C9)', () => {
  it('text: too short / pattern miss shows after leaving the box, with the builder’s errorMessage when set', async () => {
    const r = await renderKind(TextFill, f('reg', 'text', { config: { minLength: 4 } }), 'ab');
    expect(r.el.textContent).not.toContain('At least');
    box(r.el).dispatchEvent(new Event('blur'));
    await r.stable();
    expect(r.el.textContent).toContain('At least 4 characters.');
    const own = await renderKind(TextFill, f('pin', 'text', { config: { pattern: '\\d{6}', errorMessage: 'Six digits, please' } }), '12a');
    box(own.el).dispatchEvent(new Event('blur'));
    await own.stable();
    expect(own.el.textContent).toContain('Six digits, please');
    const ok = await renderKind(TextFill, f('pin', 'text', { config: { pattern: '\\d{6}' } }), '641001');
    box(ok.el).dispatchEvent(new Event('blur'));
    await ok.stable();
    expect(ok.el.querySelector('.fe-field__err')).toBeNull();
  });

  it('number: out of range uses the errorMessage when the form has one', async () => {
    const r = await renderKind(NumberFill, f('t', 'number', { config: { min: 90, max: 110, errorMessage: 'Check the thermometer' } }), 140);
    expect(r.el.textContent).toContain('Check the thermometer');
    const plain = await renderKind(NumberFill, f('t', 'number', { config: { min: 90, max: 110 } }), 140);
    expect(plain.el.textContent).toContain('The highest is 110.');
  });
});

// ───────────────────────── G8–G10, G20 ─────────────────────────
describe('options and BMI (G8–G10, G20)', () => {
  const opts = [
    { key: 'clear', label: 'Clear', description: 'Watery, like tap water' },
    { key: 'pus', label: 'Purulent' },
  ];
  it('an option’s description shows under its label (choice and multi)', async () => {
    for (const cmp of [ChoiceFill, MultiFill]) {
      const r = await renderKind(cmp, f('d', cmp === ChoiceFill ? 'choice' : 'multi', { options: opts }), null);
      // the description under the label: in a button (choice) or a card (multi, legacy multiselect-expand)
      const desc = '.fe-chip__desc, .fe-card__desc';
      expect(r.el.querySelector(`[data-option="clear"] :is(${desc})`)?.textContent).toBe('Watery, like tap water');
      expect(r.el.querySelector(`[data-option="pus"] :is(${desc})`)).toBeNull();
    }
  });

  it('display "images" (legacy imageSelect) lays the options out as tiles with a letter mark', async () => {
    const r = await renderKind(ChoiceFill, f('d', 'choice', { options: opts, config: { display: 'images' } }), null);
    expect(r.el.querySelector('.fe-chips--tiles')).not.toBeNull();
    expect(r.el.querySelector('[data-option="pus"] .fe-tile__mark')?.textContent).toBe('P');
  });

  it('BMI bands in the legacy words', () => {
    expect([bmiCategory(17), bmiCategory(18.5), bmiCategory(24.9), bmiCategory(25), bmiCategory(31), bmiCategory(null)]).toEqual([
      'Underweight',
      'Normal',
      'Normal',
      'Overweight',
      'Obese',
      null,
    ]);
  });
});

// ───────────────────────── G24 / G25 / G11: the field host ─────────────────────────
@Component({
  standalone: true,
  imports: [FieldHostComponent],
  template: `<fe-field [field]="field()" [scope]="scope()" [lookup]="lookup" [setValue]="set" />`,
})
class FieldHost {
  readonly field = signal(f('x', 'text'));
  readonly scope = signal<Record<string, unknown>>({});
  readonly lookup = (k: string) => this.scope()[k];
  readonly set = (k: string, v: unknown) => this.scope.update((s) => ({ ...s, [k]: v }));
}

describe('the field host (G11, G24, G25)', () => {
  async function host(field: ReturnType<typeof f>, scope: Record<string, unknown> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: FE_KINDS, useValue: KIND_SPECS }] });
    const fx = TestBed.createComponent(FieldHost);
    fx.componentInstance.field.set(field);
    fx.componentInstance.scope.set(scope);
    fx.detectChanges();
    await fx.whenStable();
    return fx;
  }

  it('a kind that comes later shows a calm note in plain words, never an error', async () => {
    const fx = await host(f('draw', 'unsupported', { label: 'Sketch', config: { legacyType: 'scribblePad' } }));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-later="scribblepad"]')?.textContent).toContain('Drawings come to Prepare soon');
    expect(el.textContent).toContain("won't print");
    expect(el.textContent).not.toMatch(/unsupported|error|can't be answered/i);
    expect(laterKind(f('g', 'unsupported', { config: { legacyType: 'multiTextbox' } })).title).toBe('Bring this case sheet in again to fill this table');
    expect(laterKind(f('e', 'unsupported', { config: { legacyType: 'eom' } })).icon).toBe('eye');
  });

  it('a field the form locks (legacy disabled) is shown but cannot be changed', async () => {
    const fx = await host(f('c', 'choice', { config: { disabled: true }, options: [{ key: 'a', label: 'A' }] }), { c: 'a' });
    const el = fx.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Filled in by the case sheet');
    expect((el.querySelector('[data-option="a"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('choosing an option with follow-ups brings them into view and puts the cursor in the first text box', async () => {
    vi.useFakeTimers();
    try {
      const field = f('cc', 'multi', {
        options: [{ key: 'block', label: 'Nasal block', subFields: [f('side', 'text', { label: 'Which side' })] }],
      });
      const fx = await host(field);
      const el = fx.nativeElement as HTMLElement;
      document.body.appendChild(el);
      (el.querySelector('[data-option="block"]') as HTMLButtonElement).click();
      fx.detectChanges();
      await vi.advanceTimersByTimeAsync(200);
      fx.detectChanges();
      expect(document.activeElement).toBe(el.querySelector('[data-follow="block"] .fe-text__input'));
      el.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ───────────────────────── C12: chronological pages ─────────────────────────
describe('chronological page order (C12)', () => {
  const dur = (key: string) => f(key, 'duration', { label: 'For' });
  const form = (config?: Record<string, unknown>): FormDefinition => ({
    pages: [
      {
        key: 'cc',
        title: 'Complaints',
        fields: [
          f('complaints', 'multi', {
            config,
            options: [
              { key: 'block', label: 'Nasal block', linkedPage: 'p_block', subFields: [dur('block_for')] },
              { key: 'bleed', label: 'Bleeding', linkedPage: 'p_bleed', subFields: [dur('bleed_for')] },
              { key: 'smell', label: 'Loss of smell', linkedPage: 'p_smell', subFields: [dur('smell_for')] },
            ],
          }),
        ],
      },
      { key: 'p_block', title: 'Nasal block', fields: [] },
      { key: 'p_bleed', title: 'Bleeding', fields: [] },
      { key: 'p_smell', title: 'Loss of smell', fields: [] },
      { key: 'exam', title: 'Examination', fields: [] },
    ],
  });
  const answers = {
    complaints: ['block', 'bleed', 'smell'],
    block_for: { value: 2, unit: 'weeks' },
    bleed_for: { value: 6, unit: 'months' },
    smell_for: { value: 3, unit: 'days' },
  };
  const titles = (def: FormDefinition, a: Record<string, unknown>) => wizardPages(def, a).map((p) => p.page.key);

  it('longest first by default (auto: the options have duration follow-ups and linked pages)', () => {
    expect(titles(form(), answers)).toEqual(['cc', 'p_bleed', 'p_block', 'p_smell', 'exam']);
  });

  it('shortest first when the form says asc; off when the form says enabled: false', () => {
    expect(titles(form({ chronological: { enabled: true, sortOrder: 'asc' } }), answers)).toEqual([
      'cc',
      'p_smell',
      'p_block',
      'p_bleed',
      'exam',
    ]);
    expect(titles(form({ chronological: { enabled: false } }), answers)).toEqual(['cc', 'p_block', 'p_bleed', 'p_smell', 'exam']);
  });

  it('a chosen option without a duration keeps its place after the timed ones; un-chosen pages stay put', () => {
    const a = { complaints: ['block', 'bleed', 'smell'], smell_for: { value: 1, unit: 'years' }, bleed_for: { value: 2, unit: 'days' } };
    expect(titles(form(), a)).toEqual(['cc', 'p_smell', 'p_bleed', 'p_block', 'exam']);
    expect(titles(form(), { complaints: ['bleed'] })).toEqual(['cc', 'p_block', 'p_bleed', 'p_smell', 'exam']);
    expect(chronological(form(), {}, [])).toEqual([]);
  });

  it('C13: a nested rule orders the pages by the options\' own order, or by severity (most severe first)', () => {
    const sev = (key: string) =>
      f(key, 'choice', { options: [{ key: 'mild', label: 'Mild' }, { key: 'mod', label: 'Moderate' }, { key: 'sev', label: 'Severe' }] });
    const withSev = (config: Record<string, unknown>): FormDefinition => {
      const d = form(config);
      const opts = d.pages[0].fields[0].options!;
      opts.forEach((o) => o.subFields!.push(sev(`${o.key}_sev`)));
      return d;
    };
    const a = { ...answers, complaints: ['smell', 'bleed', 'block'] };
    expect(titles(withSev({ chronological: { enabled: true, nested: { enabled: true, sortBy: 'order' } } }), a)).toEqual([
      'cc', 'p_block', 'p_bleed', 'p_smell', 'exam',
    ]);
    expect(titles(withSev({ chronological: { enabled: true, nested: { sortBy: 'order', sortOrder: 'desc' } } }), a)).toEqual([
      'cc', 'p_smell', 'p_bleed', 'p_block', 'exam',
    ]);
    const graded = { ...a, block_sev: 'mild', bleed_sev: 'sev', smell_sev: 'mod' };
    expect(titles(withSev({ chronological: { enabled: true, nested: { sortBy: 'severity' } } }), graded)).toEqual([
      'cc', 'p_bleed', 'p_smell', 'p_block', 'exam',
    ]);
    // a page with no severity answer goes after the graded ones; asc = least severe first
    const part = { ...a, block_sev: 'mild', smell_sev: 'sev' };
    expect(titles(withSev({ chronological: { enabled: true, nested: { sortBy: 'severity', sortOrder: 'asc' } } }), part)).toEqual([
      'cc', 'p_block', 'p_smell', 'p_bleed', 'exam',
    ]);
    // a rule for another field's list (trigger) or nested: true leaves the durations in charge
    expect(titles(withSev({ chronological: { enabled: true, nested: { sortBy: 'order', trigger: 'other' } } }), a)).toEqual(titles(form(), a));
    expect(titles(withSev({ chronological: { enabled: true, nested: true } }), a)).toEqual(titles(form(), a));
  });

  it('durations compare across units; a period of the day is morning < night', () => {
    expect(durationWeight({ value: 1, unit: 'years' })! > durationWeight({ value: 11, unit: 'months' })!).toBe(true);
    expect(durationWeight({ amount: 2, unit: 'week' })).toBe(14 * 86400);
    expect(durationWeight('morning')! < durationWeight('night')!).toBe(true);
    expect(durationWeight(null)).toBeNull();
  });
});

// ───────────────────────── A9: arranged repetitions ─────────────────────────
describe('repeated pages in the doctor’s order (A9, J10)', () => {
  const rp = f('ulcers', 'repeatPages', { label: 'Ulcers', config: { pages: ['ulcer'], orderMode: 'instance' } });
  const def: FormDefinition = {
    pages: [
      { key: 'p', title: 'Ulcers', fields: [rp] },
      { key: 'ulcer', title: 'Ulcer', fields: [f('site', 'text')] },
    ],
  };
  const value = {
    instances: [
      { page: 'ulcer', index: 0, values: { site: 'heel' } },
      { page: 'ulcer', index: 1, values: { site: 'toe' } },
    ],
  };

  it('Move later swaps two repetitions; the wizard and the list follow that order', async () => {
    const r = await renderKind(RepeatPagesFill, rp, value, { wizard: { goTo: () => undefined, pageTitle: () => 'Ulcer' } });
    expect(untouchable(r.el)).toEqual([]);
    const later = r.el.querySelector<HTMLButtonElement>('[aria-label="Move Ulcer 1 later"]')!;
    expect(r.el.querySelector<HTMLButtonElement>('[aria-label="Move Ulcer 1 earlier"]')!.disabled).toBe(true);
    await r.click(later);
    const moved = r.last() as typeof value;
    expect(moved.instances.map((i) => i.values.site)).toEqual(['toe', 'heel']);
    expect(wizardPages(def, { ulcers: moved }).map((p) => p.title)).toEqual(['Ulcers', 'Ulcer 2', 'Ulcer 1']);
  });

  it('static order (the default) still sorts by number; a resize keeps an arranged order and adds at the end', () => {
    const staticDef: FormDefinition = { pages: [{ ...def.pages[0], fields: [{ ...rp, config: { pages: ['ulcer'] } }] }, def.pages[1]] };
    const swapped = { instances: [value.instances[1], value.instances[0]] };
    expect(wizardPages(staticDef, { ulcers: swapped }).map((p) => p.title)).toEqual(['Ulcers', 'Ulcer 1', 'Ulcer 2']);
    const grown = resizeInstances(rp, swapped, 3);
    expect(grown.instances.map((i) => `${i.index}`)).toEqual(['1', '0', '2']);
  });
});

// ───────────────────────── G25: later kinds never block ─────────────────────────
describe('kinds that come later never block a page', () => {
  it('they are not counted as questions (progress, auto-advance, Finish)', () => {
    const page = {
      key: 'p',
      title: 'P',
      fields: [f('a', 'text', { required: true }), f('sketch', 'unsupported', { required: true, config: { legacyType: 'scribblePad' } })],
    };
    expect(visibleFields(page, lookupIn({})).map((x) => x.key)).toEqual(['a']);
  });
});


// ───────────────────────── sentences for combinations (shared vectors) ─────────────────────────
// docs/vectors/casesheet-combinations.json is authored with the server (prefrontal-mw, MultiNarration) and must stay
// byte-identical in both repos. The TS engine does not write the whole narrative (the API does, with follow-up
// questions): it decides which combination fires and writes the picks' words, the total and "Denies …" (Studio's
// preview line). Cases with follow-up questions are checked for the rule that fires only.
describe('combination sentences match the server (shared vectors docs/vectors/casesheet-combinations.json)', () => {
  type Case = { name: string; field: FieldDef; answers: Record<string, unknown>; expect: string; fires: string | null };
  const cases = (combos as unknown as { cases: Case[] }).cases;

  it('the copy under testing/ is the repo\'s docs/vectors file', () => {
    const docs = readFileSync(resolve(process.cwd(), 'docs/vectors/casesheet-combinations.json'), 'utf8');
    expect(JSON.parse(docs)).toEqual(combos);
  });

  for (const c of cases) {
    it(c.name, () => {
      const picked = pickedKeys(c.field, c.answers[c.field.key]);
      expect(picksWords(c.field, picked).fires).toBe(c.fires);
      const hasFollowUps = (c.field.options ?? []).some((o) => (o.subFields ?? []).length > 0);
      if (!hasFollowUps) expect(narratePicks(c.field, picked)).toBe(c.expect);
    });
  }
});
