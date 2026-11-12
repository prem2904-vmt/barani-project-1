import { Component, Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NgComponentOutlet } from '@angular/common';
import { vi } from 'vitest';
import { Answers, FieldDef } from '../core/types';
import { AssetStore, FE_ASSETS, FE_KINDS, FE_SUGGESTIONS, FE_VOICE, FE_WIZARD, KindFill, SuggestionSource, VoiceInput, WizardNav } from '../fill/contract';
import { FeDialog, FeDialogApi } from '../kit';
import { KIND_SPECS } from '../kinds/registry';

/**
 * Test harness for one fill control: renders it the way the field host does
 * (inputs field / value / set / labelId), records every `set` and feeds the
 * value back so the control sees its own change (like the real page).
 */
@Component({
  standalone: true,
  imports: [NgComponentOutlet],
  template: `<span [id]="'lbl'">{{ field().label }}</span>
    <ng-container
      [ngComponentOutlet]="cmp"
      [ngComponentOutletInputs]="{
        field: field(),
        value: value(),
        disabled: disabled(),
        set: set,
        labelId: 'lbl',
        scope: scope(),
        lookup: lookup,
      }"
    />`,
})
class KindHost {
  cmp!: Type<KindFill>;
  readonly field = signal<FieldDef>({ key: 'x', kind: 'text', label: 'X' });
  readonly value = signal<unknown>(null);
  readonly disabled = signal(false);
  readonly scope = signal<Answers>({});
  readonly calls: unknown[] = [];
  readonly set = (v: unknown) => {
    this.calls.push(v);
    this.value.set(v);
    this.scope.update((s) => ({ ...s, [this.field().key]: v }));
  };
  readonly lookup = (k: string) => this.scope()[k];
}

export interface Rendered {
  el: HTMLElement;
  host: KindHost;
  /** Every value the control wrote, in order. */
  calls: unknown[];
  last(): unknown;
  click(selector: string | Element): Promise<void>;
  setValue(v: unknown): Promise<void>;
  setDisabled(d: boolean): Promise<void>;
  buttons(): HTMLButtonElement[];
  byText(text: string, selector?: string): HTMLElement;
  stable(): Promise<void>;
  /** The rendered control's instance (for state a browser would set, e.g. a measured width). */
  instance<T>(type: Type<T>): T;
}

export async function renderKind(
  cmp: Type<KindFill>,
  field: FieldDef,
  value: unknown = null,
  opts: {
    voice?: VoiceInput | null;
    wizard?: WizardNav | null;
    scope?: Answers;
    suggestions?: SuggestionSource | null;
    dialog?: Partial<FeDialogApi>;
    assets?: AssetStore | null;
  } = {},
): Promise<Rendered> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FE_KINDS, useValue: KIND_SPECS },
      { provide: FE_VOICE, useValue: opts.voice ?? null },
      { provide: FE_WIZARD, useValue: opts.wizard ?? null },
      { provide: FE_SUGGESTIONS, useValue: opts.suggestions ?? null },
      { provide: FE_ASSETS, useValue: opts.assets ?? null },
      ...(opts.dialog ? [{ provide: FeDialog, useValue: opts.dialog }] : []),
    ],
  });
  const fixture = TestBed.createComponent(KindHost);
  const host = fixture.componentInstance;
  host.cmp = cmp;
  host.field.set(field);
  host.value.set(value);
  host.scope.set({ ...(opts.scope ?? {}), [field.key]: value });
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return {
    el,
    host,
    calls: host.calls,
    last: () => host.calls[host.calls.length - 1],
    stable,
    async click(selector) {
      const t = typeof selector === 'string' ? el.querySelector<HTMLElement>(selector) : (selector as HTMLElement);
      if (!t) throw new Error(`nothing matches ${String(selector)}`);
      t.click();
      await stable();
    },
    async setValue(v) {
      host.value.set(v);
      host.scope.update((s) => ({ ...s, [field.key]: v }));
      await stable();
    },
    async setDisabled(d) {
      host.disabled.set(d);
      await stable();
    },
    buttons: () => [...el.querySelectorAll('button')],
    instance: <T,>(type: Type<T>) => fixture.debugElement.query(By.directive(type)).componentInstance as T,
    byText(text, selector = 'button') {
      const hit = [...el.querySelectorAll<HTMLElement>(selector)].find((b) => b.textContent?.trim() === text);
      if (!hit)
        throw new Error(
          `no ${selector} with text "${text}"; have: ${[...el.querySelectorAll(selector)].map((b) => b.textContent?.trim()).join(' | ')}`,
        );
      return hit;
    },
  };
}

/**
 * The classes that guarantee a ≥48px box (each declares min-height
 * var(--pf-touch) or more in _fill.scss / _touch.scss; `fill-styles.spec`
 * proves it). Every button a control renders must carry one.
 */
export const TOUCH_CLASSES = [
  'fe-chip',
  'fe-stepper__btn',
  'fe-iconbtn',
  'fe-numbox',
  'fe-pad__key',
  'pf-btn',
  'pf-touch',
  // the canvas engine and the image kinds (_canvas.scss)
  'fe-cv__tool',
  'fe-cv__swatch',
  'fe-cv__pin',
  'fe-cv__marker',
  'fe-photo',
  'fe-eye__mk',
  'fe-pick__tile',
  'fe-areas__handle',
  'fe-kpanel__area',
  'fe-kpanel__mini',
  // the grid (kinds/grid/_grid.scss)
  'fe-gridk__cell',
  'fe-gridk__head',
  'fe-gridk__rowlab',
  // picture choice (kinds/pictureChoice/_picture-choice.scss)
  'fe-pc__part',
];

export function untouchable(el: HTMLElement): string[] {
  return [...el.querySelectorAll('button')]
    .filter((b) => !TOUCH_CLASSES.some((c) => b.classList.contains(c)))
    .filter((b) => !b.closest('pf-select'))
    .map((b) => b.outerHTML.slice(0, 120));
}

/** Every button has a name a screen reader can say. */
export function unnamed(el: HTMLElement): string[] {
  return [...el.querySelectorAll('button')]
    .filter((b) => !b.closest('pf-select'))
    .filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim()))
    .map((b) => b.outerHTML.slice(0, 120));
}

export const f = (key: string, kind: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  kind,
  label: extra.label ?? key,
  ...extra,
});

export { vi };
