import { NgTemplateOutlet } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, inject, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { FormDefinition } from '@prefrontal/forms-engine';
import { vi } from 'vitest';
import { DialogService } from '../../../core/services/dialog.service';
import { CASE_CACHE, MemoryCaseCache } from '../data/cases/case-cache';
import { CasesApi } from '../data/cases/cases-api';
import { SESSION_TIMING } from '../data/cases/case-session';
import { MockCasesApi } from '../data/cases/mock-cases-api';
import { FormBarService } from '../data/form-bar/form-bar.service';
import { CasePage, HOLD_FINISH, HOLD_LEAVE, HOLD_NOTE } from './case.page';

/**
 * The filling flow, legacy-faithful (memory prepare-legacy-fidelity; pf-work/plans/prepare-legacy-fidelity.md
 * "Gestures and timings"), in the lab: the sheet opens at page 1, its Back · Pages · Next ride the ONE bottom bar
 * (FormBarService — the host below stands in for the LMS top-strip's `pf-formbar` slot), tap Next turns the page,
 * HOLD Next (200 ms + 1.5 s) finishes from any page → "Edit your report", HOLD Pages (200 ms + 0.8 s) goes back to
 * Departments for the patient, tap the PF logo goes to Departments, HOLD the logo (300 ms + 1.2 s) adds a "Voice note"
 * section, and letting go mid-hold is never a tap.
 */
const FLOW: FormDefinition = {
  title: 'Flow',
  pages: [
    { key: 'p1', title: 'Complaint', fields: [{ key: 'complaint', kind: 'text', label: 'Complaint' }] },
    { key: 'p2', title: 'History', fields: [{ key: 'history', kind: 'text', label: 'History' }] },
    { key: 'p3', title: 'Plan', fields: [{ key: 'plan', kind: 'text', label: 'Plan' }] },
  ],
} as FormDefinition;

@Component({
  standalone: true,
  imports: [CasePage, NgTemplateOutlet],
  template: `
    <app-case-page [id]="id()" />
    <nav class="test-bar" data-bar>
      @if (bar.template(); as t) { <ng-container [ngTemplateOutlet]="t" /> }
    </nav>
  `,
})
class Host {
  readonly id = input.required<string>();
  protected readonly bar = inject(FormBarService);
}

// The page provides its own CasesApi (CASESHEETS_DATA_PROVIDERS); the spec adds the mock on top. The added provider
// reads `current` so each test's mock is the one used (a component override outlives TestBed resets).
let current: MockCasesApi;

const press = (el: Element, type: string) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5 }));

describe('case sheet filling (legacy gestures, one bottom bar)', () => {
  let api: MockCasesApi;
  let f: ComponentFixture<Host>;
  let el: HTMLElement;
  let router: Router;
  let sheetId: string;
  let destroyed: boolean;
  let dialog: { prompt: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; alert: ReturnType<typeof vi.fn>; actions: ReturnType<typeof vi.fn> };

  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    f.detectChanges();
  };
  const title = () => el.querySelector('.lf-title__text')?.textContent?.trim();
  const bar = () => el.querySelector('[data-bar]') as HTMLElement;
  const q = (sel: string) => el.querySelector(sel) as HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    api = current = new MockCasesApi();
    api.addForm('flow', FLOW);
    dialog = {
      prompt: vi.fn(async () => null),
      confirm: vi.fn(async () => true),
      alert: vi.fn(async () => undefined),
      actions: vi.fn(async () => ({ action: null, checked: false })),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DialogService, useValue: dialog },
        { provide: CASE_CACHE, useValue: new MemoryCaseCache() },
        { provide: SESSION_TIMING, useValue: { debounceMs: 50, narrativeDebounceMs: 10, backoff: () => 1000 } },
      ],
    });
    TestBed.overrideComponent(CasePage, { add: { providers: [{ provide: CasesApi, useFactory: () => current }] } });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const sheet = await api.createCase('flow', { name: 'Asha', age: '42 years', sex: 'Female', ref: 'MRN-1' }, { patientId: 'p1' });
    sheetId = sheet.id;
    destroyed = false;
    f = TestBed.createComponent(Host);
    f.componentRef.setInput('id', sheet.id);
    el = f.nativeElement as HTMLElement;
    f.detectChanges();
    await settle(100);
  });

  afterEach(() => {
    if (!destroyed) f?.destroy();
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('opens at page 1 with the page title in the header and Back · Pages · Next in the bottom bar', () => {
    expect(title()).toBe('Complaint');
    // the lab sheet carries the LMS patient: the header's second line names them (the form has no name field)
    expect(q('.lf-title__who')?.textContent).toContain('Asha');
    expect(bar().querySelector('.lf-bar')).not.toBeNull();
    expect((bar().querySelector('.lf-back') as HTMLButtonElement).disabled).toBe(true);
    expect(bar().querySelector('.lf-pages')).not.toBeNull();
    expect(bar().querySelector('.lf-next')?.textContent).toContain('Next');
    expect(document.documentElement.classList.contains('cs-touch')).toBe(true);
  });

  it('tap Next turns the page; Back comes back; the last page shows Finish', async () => {
    (bar().querySelector('.lf-next') as HTMLElement).click();
    await settle();
    expect(title()).toBe('History');
    (bar().querySelector('.lf-back') as HTMLElement).click();
    await settle();
    expect(title()).toBe('Complaint');
    (bar().querySelector('.lf-next') as HTMLElement).click();
    await settle();
    (bar().querySelector('.lf-next') as HTMLElement).click();
    await settle();
    expect(title()).toBe('Plan');
    expect(bar().querySelector('.lf-finish')?.textContent).toContain('Finish');
  });

  it('HOLD Next (200 ms + 1.5 s) finishes from page 1: "Edit your report" opens; the click after the hold is no tap', async () => {
    expect(HOLD_FINISH).toEqual({ delay: 200, fill: 1500 });
    const next = bar().querySelector('.lf-next') as HTMLElement;
    press(next, 'pointerdown');
    await settle(HOLD_FINISH.delay + 10);
    expect(next.textContent).toContain('Hold to finish');
    await settle(HOLD_FINISH.fill);
    next.click(); // the release's click
    await settle();
    expect(q('[data-report]')).not.toBeNull();
    expect(q('[data-report]').textContent).toContain('Edit your report');
    expect(title()).toBe('Complaint'); // the swallowed click did not turn the page
    q('[data-finish-now]').click();
    await settle(100);
    expect(api.sheets.get(sheetId)!.sheet.state).toBe('final');
    expect(bar().querySelector('.lf-bar')).toBeNull(); // finished: the bar's work areas come back
  });

  it('letting go of Next before the fill completes neither finishes nor taps', async () => {
    const next = bar().querySelector('.lf-next') as HTMLElement;
    press(next, 'pointerdown');
    await settle(HOLD_FINISH.delay + 600);
    press(next, 'pointerup');
    await settle(2000);
    expect(q('[data-report]')).toBeNull();
    expect(title()).toBe('Complaint');
  });

  it('HOLD Pages (200 ms + 0.8 s) goes back to Departments for this patient; tap Pages opens the page list', async () => {
    expect(HOLD_LEAVE).toEqual({ delay: 200, fill: 800 });
    const pages = bar().querySelector('.lf-pages') as HTMLElement;
    pages.click();
    await settle();
    expect(bar().querySelector('#lf-menu')?.textContent).toContain('Go to a page');
    expect(bar().querySelector('#lf-menu')?.textContent).toContain('Hold Pages to go back to Departments');
    press(pages, 'pointerdown');
    await settle(HOLD_LEAVE.delay + HOLD_LEAVE.fill + 10);
    await settle(50);
    expect(router.navigate).toHaveBeenCalledWith(['/casesheets/new'], { queryParams: { patientId: 'p1' } });
  });

  it('tap the PF logo: Departments for the patient (after saving)', async () => {
    q('.lf-logo').click();
    await settle(50);
    expect(router.navigate).toHaveBeenCalledWith(['/casesheets/new'], { queryParams: { patientId: 'p1' } });
  });

  it('HOLD the PF logo (300 ms + 1.2 s): a "Voice note" section of your own; letting go mid-hold is no tap', async () => {
    expect(HOLD_NOTE).toEqual({ delay: 300, fill: 1200 });
    const logo = q('.lf-logo');
    // mid-hold release: nothing, and the click that follows is swallowed (no navigation)
    press(logo, 'pointerdown');
    await settle(HOLD_NOTE.delay + 200);
    press(logo, 'pointerup');
    logo.click();
    await settle(50);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(api.calls.some((c) => c.op === 'addOwnSection')).toBe(false);
    // the full hold: a new own section titled "Voice note", the narrative opens for it
    press(logo, 'pointerdown');
    await settle(HOLD_NOTE.delay + HOLD_NOTE.fill + 10);
    logo.click();
    await settle(100);
    const own = api.calls.find((c) => c.op === 'addOwnSection');
    expect(own).toBeDefined();
    expect(JSON.stringify(own!.args)).toContain('Voice note');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(q('#cs-narrative').classList.contains('lf-nv--open')).toBe(true);
  });

  it('keys: → next, ← back, Ctrl+Shift+Enter finish (legacy shortcuts)', async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(title()).toBe('History');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await settle();
    expect(title()).toBe('Complaint');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true }));
    await settle();
    expect(q('[data-report]')).not.toBeNull();
  });

  it('leaving the sheet gives the bottom bar back', async () => {
    expect(bar().querySelector('.lf-bar')).not.toBeNull();
    const formBar = TestBed.inject(FormBarService);
    f.destroy();
    destroyed = true;
    expect(formBar.template()).toBeNull();
    expect(document.documentElement.classList.contains('cs-touch')).toBe(false);
  });
});
