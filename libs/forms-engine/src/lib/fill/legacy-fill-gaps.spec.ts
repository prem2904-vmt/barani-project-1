import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FE_KINDS, FE_WIZARD, WizardNav } from './contract';
import { FieldHostComponent } from './field-host.component';
import { KIND_SPECS } from '../kinds/registry';
import { f } from '../testing/render-kind';

/** Legacy fill gaps (plans/casesheet-legacy-gaps-visual.md, 2026-11-12): the host-level ones. Control-level ones live beside their kind. */
@Component({
  standalone: true,
  imports: [FieldHostComponent],
  template: `<fe-field [field]="field()" [scope]="scope()" [lookup]="lookup" [setValue]="set" />`,
})
class Host {
  readonly field = signal(f('x', 'text'));
  readonly scope = signal<Record<string, unknown>>({});
  readonly lookup = (k: string) => this.scope()[k];
  readonly set = (k: string, v: unknown) => this.scope.update((s) => ({ ...s, [k]: v }));
}

const nav = (legacy: boolean): WizardNav => ({ goTo: () => undefined, pageTitle: (k) => k, isLegacy: () => legacy });

async function host(field: ReturnType<typeof f>, legacy: boolean) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: FE_KINDS, useValue: KIND_SPECS }, { provide: FE_WIZARD, useValue: nav(legacy) }] });
  const fx = TestBed.createComponent(Host);
  fx.componentInstance.field.set(field);
  fx.detectChanges();
  await fx.whenStable();
  return fx.nativeElement as HTMLElement;
}

describe('G12: the required star', () => {
  it('a required question shows the star right after its label', async () => {
    const el = await host(f('side', 'choice', { label: 'Affected side', required: true, options: [{ key: 'r', label: 'Right' }] }), true);
    expect(el.querySelector('.fe-field__req')).not.toBeNull();
  });
  it('legacy: a required duration shows no star (the old duration box had none); a new case sheet keeps it', async () => {
    const dur = f('d', 'duration', { label: 'Duration', required: true, config: {} });
    expect((await host(dur, true)).querySelector('.fe-field__req')).toBeNull();
    expect((await host(dur, false)).querySelector('.fe-field__req')).not.toBeNull();
  });
});

describe('G16: the old duration-time box printed no question above it', () => {
  it('legacy: the clock-scale label is for screen readers only; a new sheet shows it', async () => {
    const clock = f('rt', 'duration', { label: 'Recovery time', config: { scale: 'clock' } });
    expect((await host(clock, true)).querySelector('.fe-field__lbl')?.classList.contains('fe-sr-only')).toBe(true);
    expect((await host(clock, false)).querySelector('.fe-field__lbl')?.classList.contains('fe-sr-only')).toBe(false);
  });
});

describe('G9: choices fill their panel (stylesheet proof)', () => {
  const css = readFileSync(resolve(process.cwd(), 'libs/forms-engine/src/lib/fill/_fill.scss'), 'utf8');
  it('a follow-up panel stretches its controls, the page grid no longer makes them content-width', () => {
    expect(css).toMatch(/\.fe-follow \.fe-grid \{[^}]*align-items: stretch/);
  });
  it('buttons share a row equally and wrap by word, not by letter', () => {
    expect(css).toMatch(/\.fe-chips--row > \.fe-chip \{[^}]*flex: 1 1 0;[^}]*min-width: min-content;[^}]*overflow-wrap: break-word/);
  });
});
