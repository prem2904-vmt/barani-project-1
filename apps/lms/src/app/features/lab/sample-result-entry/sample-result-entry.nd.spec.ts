import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { SampleResultEntryComponent } from './sample-result-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { DraftShelfService } from '../../../core/services/draft-shelf.service';

/**
 * Result entry on the nd pattern (docs/ND-PATTERN.md → "Result entry"):
 * band (back + tenant + Save draft / Submit) + CONTEXT BAR, full-width
 * RESULTS cards (grid only, no side panel), tube tabs in a FIXED order, and
 * the zoom name shared with the queue tile.
 */
const FULL_NAME = 'Mr. Sathish Kumaravel Ramasamy';
const PARAMS = JSON.stringify({
  parameters: [
    { name: 'target', title: 'Target Detection', type: 'select', options: ['Detected', 'Not detected'], methodology: 'Real-Time PCR' },
    { name: 'adequacy', title: 'Sample Adequacy', type: 'select', options: ['Adequate', 'Inadequate'] },
    { name: 'qc', title: 'Molecular QC', type: 'select', options: ['Pass', 'Fail'] },
  ],
});

function sampleFixture(rich: boolean): any {
  return {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-09-25T03:00:00Z',
    department: { id: 'd1', name: 'Molecular', code: 'MOL' },
    ...(rich ? { collectedAt: '2026-09-25T04:10:00Z', receivedAtLab: '2026-09-25T05:00:00Z', tubeColor: 'sterile' } : {}),
    order: {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-09-25T03:00:00Z', samples: [],
      ...(rich ? { refDoctorName: 'Dr. Meera Rao', orderNumber: 'LAB-2609-000123' } : {}),
      patient: { id: 'p1', displayName: FULL_NAME, age: 29, sex: 'Male', mrn: 'AA0012' },
    },
    siblings: [{ id: 'smp-2', barcode: '26124', tests: ['Bacterial Identification'], hasOpenWork: true }],
    tests: [{
      id: 'ot1', subOrderId: 'smp-1', testId: 't1', name: 'Bacterial PCR Detection', status: 'in_progress',
      test: {
        id: 't1', name: 'Bacterial PCR Detection', parameters: PARAMS,
        ...(rich ? { sampleType: 'Nasal swab', tatHours: 24 } : {}),
      },
    }],
  };
}

/** The sibling tube: the server lists ITS siblings (the first tube). */
function siblingFixture(): any {
  const s = sampleFixture(false);
  return {
    ...s, id: 'smp-2', barcode: '26124',
    siblings: [{ id: 'smp-1', barcode: '26123', tests: ['Bacterial PCR Detection'], hasOpenWork: true }],
    tests: [{ ...s.tests[0], id: 'ot2', subOrderId: 'smp-2', testId: 't2', name: 'Bacterial Identification',
      test: { ...s.tests[0].test, id: 't2', name: 'Bacterial Identification' } }],
  };
}

async function render(opts: {
  rich?: boolean; hold?: boolean; single?: boolean;
  sibling?: () => any; post?: (url: string, body: any) => any; confirm?: boolean;
} = {}) {
  const sample = sampleFixture(!!opts.rich);
  if (opts.single) sample.siblings = [];
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const api = {
    get: vi.fn((url: string) => {
      if (url.endsWith('/smp-2/tests')) return of((opts.sibling ?? siblingFixture)());
      if (url.endsWith('/tests')) return opts.hold ? { subscribe: (o: any) => { gate.then(() => o.next(sample)); return { unsubscribe() {} }; } } as any : of(sample);
      if (url.includes('lab-trends')) return of({ tests: [] });
      return of([]);
    }),
    post: vi.fn((url: string, body: any) => (opts.post ? opts.post(url, body) : of({}))), patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  // A live route: navigating to /lab/sample/:id re-emits the param (the
  // component is REUSED, as the real router does for a same-route hop).
  const params$ = new BehaviorSubject(convertToParamMap({ sampleId: 'smp-1' }));
  const query$ = new BehaviorSubject(convertToParamMap({}));
  const route = { paramMap: params$, queryParamMap: query$,
    snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map() } };
  const router = {
    url: '/lab/sample/smp-1',
    navigate: vi.fn((cmds: unknown[]) => {
      if (cmds[0] === '/lab/sample' && cmds[1] !== params$.value.get('sampleId'))
        params$.next(convertToParamMap({ sampleId: String(cmds[1]) }));
      return Promise.resolve(true);
    }),
  };
  const dialog = { confirm: vi.fn(async (_req: any) => !!opts.confirm), prompt: vi.fn() };
  const shelf = { drop: vi.fn() };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: toasts },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', registrationId: '123434', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: DialogService, useValue: dialog },
      { provide: DraftShelfService, useValue: shelf },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: router },
    ],
  });
  const f = TestBed.createComponent(SampleResultEntryComponent);
  f.detectChanges();
  if (!opts.hold) {
    await f.whenStable();
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
  }
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, release, api, params$, query$, router, dialog, shelf, toasts };
}

/** Component CSS with Angular's scoping attributes stripped. */
const css = () => ((SampleResultEntryComponent as any).ɵcmp.styles as string[]).join('\n')
  .replace(/\[_ng(content|host)-%COMP%\]/g, '');

describe('Result entry (nd) — band + CONTEXT BAR', () => {
  it('the band keeps back + tenant; on web the pill carries ONLY the patient (no current-sample chip)', async () => {
    const { el } = await render();
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
    // The old big header block is gone.
    expect(el.querySelector('.pf-sre__hdr')).toBeNull();
    expect(el.querySelector('.pf-sre__title')).toBeNull();

    const ctx = el.querySelector('pf-hero-band .pf-sre-ctx') as HTMLElement;
    expect(ctx).not.toBeNull();
    expect(ctx.querySelector('.pf-sre-chip--patient .pf-sre-chip__meta')!.textContent!.trim()).toBe('29/M · AA0012');
    // Web/tablet: the tabs already say which tube is open — the sample chip
    // is PHONE-only (hidden >640px).
    const chip = el.querySelector('.pf-sre-chip--sample')!;
    expect(chip.closest('.pf-sre-phone')).not.toBeNull();
    expect(css()).toMatch(/\.pf-sre-phone\s*\{\s*display:\s*none\s*!important/);
    expect(ctx.textContent).not.toContain('MOL');
    // The technician is not in the pill any more…
    expect(ctx.querySelector('.pf-sre-techchip, .pf-sre-chip--tech')).toBeNull();
  });

  it('the technician chip sits in the band actions, left of Save draft', async () => {
    const { el } = await render();
    const actions = el.querySelector('pf-hero-band .pf-hb__actions') as HTMLElement;
    const chip = actions.querySelector('.pf-sre-techchip') as HTMLElement;
    expect(chip.classList).toContain('nd-chip');
    expect(chip.textContent).toContain('Admin User');
    expect(chip.textContent).toContain('123434');
    const kids = Array.from(actions.querySelectorAll('.pf-sre-techchip, .pf-sre-draft, .pf-sre-submit'));
    expect(kids.map(k => k.classList.contains('pf-sre-techchip') ? 'tech' : k.classList.contains('pf-sre-draft') ? 'draft' : 'submit'))
      .toEqual(['tech', 'draft', 'submit']);
    // Phones: an initials avatar in the band (Reg in the tooltip).
    const av = actions.querySelector('.pf-sre-techavatar') as HTMLElement;
    expect(av.textContent!.trim()).toBe('AU');
    expect(av.getAttribute('title')).toContain('123434');

  });

  it('grid only: no Grid / Form control anywhere', async () => {
    const { el, c } = await render();
    expect(el.querySelector('.pf-sre-mode')).toBeNull();
    const labels = Array.from(el.querySelectorAll('button')).map(b => b.textContent!.trim());
    expect(labels).not.toContain('Grid');
    expect(labels).not.toContain('Form');
    expect(c.setViewMode).toBeUndefined();
    expect(el.querySelector('.pf-sre__params')).toBeNull();
  });

  it('the band carries Save draft (secondary) + Submit results (the single primary)', async () => {
    const { el } = await render({ single: true });
    const actions = el.querySelector('pf-hero-band .pf-hb__actions') as HTMLElement;
    const draft = actions.querySelector('.pf-sre-draft') as HTMLButtonElement;
    const submit = actions.querySelector('.pf-sre-submit') as HTMLButtonElement;
    expect(draft.textContent!.trim()).toBe('Save draft');
    expect(draft.classList).toContain('pf-hb-btn--ghost');
    expect(submit.textContent!.trim()).toBe('Submit results');
    expect(submit.classList).toContain('pf-hb-btn--primary');
    expect(submit.disabled).toBe(false);
    expect(actions.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary').length).toBe(1);
    // The old huge gradient bar is gone.
    expect(el.querySelector('.pf-sre__footer')).toBeNull();
  });

  it('Submit keeps its disabled logic (nothing writable → disabled)', async () => {
    const { f, el, c } = await render({ single: true });
    c._sample.update((s: any) => ({ ...s, tests: s.tests.map((t: any) => ({ ...t, status: 'validated' })) }));
    f.detectChanges();
    const submit = el.querySelector('pf-hero-band .pf-sre-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(el.querySelector('pf-hero-band .pf-sre-draft')).toBeNull();
  });

  it('phones: Save draft + Submit are 44px ICON buttons in the band (Submit primary); no bottom bar', async () => {
    const { el } = await render({ single: true });
    expect(el.querySelector('.nd-bottombar')).toBeNull();
    const actions = el.querySelector('pf-hero-band .pf-hb__actions') as HTMLElement;
    const draft = actions.querySelector('.pf-sre-draft') as HTMLElement;
    const submit = actions.querySelector('.pf-sre-submit') as HTMLElement;
    expect(draft.getAttribute('aria-label')).toBe('Save draft');
    expect(submit.getAttribute('aria-label')).toBe('Submit results');
    expect(draft.getAttribute('title')).toContain('Save draft');
    expect(submit.getAttribute('title')).toBe('Submit results');
    expect(draft.querySelector('svg.pf-sre-act__i')).not.toBeNull();
    expect(submit.querySelector('svg.pf-sre-act__i')).not.toBeNull();
    expect(submit.classList).toContain('pf-hb-btn--primary');
    const c = css();
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-band\s+\.pf-sre-act\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-band\s+\.pf-sre-act__i\s*\{\s*display:\s*block/);
    // Web keeps the TEXT buttons: the icon is hidden by default.
    expect(c).toMatch(/\.pf-sre-act__i\s*\{\s*display:\s*none/);
  });

  it('the saved state shows as a dot on the save icon, with the time in its tooltip', async () => {
    const { f, el, c } = await render();
    c._lastSavedAt.set(new Date(2026, 8, 25, 14, 2));
    f.detectChanges();
    const draft = el.querySelector('pf-hero-band .pf-sre-draft') as HTMLElement;
    expect(draft.querySelector('.pf-sre-act__saved')).not.toBeNull();
    expect(draft.getAttribute('title')).toBe('Save draft · Saved 14:02');
  });

  it('sample tabs: this tube + siblings as a neutral segmented control; draft values = violet dot, all filled = check', async () => {
    const { f, el, c } = await render();
    const tabs = el.querySelector('pf-hero-band .pf-sre-tabs') as HTMLElement;
    expect(tabs.classList).toContain('nd-seg');
    const items = tabs.querySelectorAll('[role="tab"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('aria-selected')).toBe('true');
    // Tabs render ONLY the sample IDs; the tests ride in tooltip / aria-label.
    expect(items[0].textContent!.trim()).toBe('26123');
    expect(items[1].textContent!.trim()).toBe('26124');
    expect(items[1].getAttribute('title')).toBe('Bacterial Identification');
    expect(items[1].getAttribute('aria-label')).toContain('Bacterial Identification');
    // Nothing typed anywhere yet: no marks.
    expect(el.querySelector('.pf-sre-tabs .pf-sre-tab__dot, .pf-sre-tabs .pf-sre-tab__ok')).toBeNull();
    // Some values on this tube → the dot ("has unsaved or draft values").
    c.setValue('ot1', 'target', 'Detected');
    f.detectChanges();
    expect(items[0].querySelector('.pf-sre-tab__dot')!.getAttribute('aria-label')).toBe('Has unsaved or draft values');
    // Every field filled → the check ("ready for Submit all").
    c.setValue('ot1', 'adequacy', 'Adequate');
    c.setValue('ot1', 'qc', 'Pass');
    f.detectChanges();
    expect(items[0].querySelector('.pf-sre-tab__dot')).toBeNull();
    expect(items[0].querySelector('svg.pf-sre-tab__ok')!.getAttribute('aria-label')).toBe('Every field filled');
    expect(items[1].querySelector('.pf-sre-tab__dot, .pf-sre-tab__ok')).toBeNull();
    expect(css()).toMatch(/\.pf-sre-tab__dot[^{]*\{[^}]*background:\s*var\(--color-violet-500/);
    expect(el.querySelector('select')).toBeNull();
  });

  it('tab order is FIXED: switching tubes moves only the selection, never the tabs', async () => {
    const { f, el, c } = await render();
    const order = () => Array.from(el.querySelectorAll('.pf-sre-tabs [role="tab"]')).map(b => b.getAttribute('data-tube'));
    const selected = () => el.querySelector('.pf-sre-tabs [aria-selected="true"]')!.getAttribute('data-tube');
    expect(order()).toEqual(['smp-1', 'smp-2']);
    expect(selected()).toBe('smp-1');
    const firstBtn = el.querySelector('.pf-sre-tabs [data-tube="smp-1"]');
    await c.openSibling('smp-2');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(order()).toEqual(['smp-1', 'smp-2']);          // same positions
    expect(selected()).toBe('smp-2');                     // only the indicator moved
    expect(el.querySelector('.pf-sre-tabs [data-tube="smp-1"]')).toBe(firstBtn);   // same DOM node
    // The indicator slides on the nd spring; off under reduced motion.
    expect(css()).toMatch(/\.pf-sre-tabs--anim\s+\.pf-sre-tabs__ind\s*\{[^}]*transition:\s*transform[^;]*var\(--nd-spring\)/);
    expect(css()).toMatch(/prefers-reduced-motion[\s\S]*\.pf-sre-tabs__ind[^{]*\{[^}]*transition:\s*none/);
  });

  it('phones: no tabs control; the current sample chip is the tube switcher (2+ tubes)', async () => {
    const { f, el, c } = await render();
    expect(css()).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-tabs\[role=['"]?tablist['"]?\]\s*\{\s*display:\s*none\s*!important/);
    const chip = el.querySelector('.pf-sre-ctx .pf-sre-chip--switch') as HTMLButtonElement;
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.textContent).toContain('26123');
    expect(chip.querySelector('svg')).not.toBeNull();             // the chevron
    chip.click();
    f.detectChanges();
    const opts = Array.from(el.querySelectorAll('.pf-sre-switch__menu [role="option"]')) as HTMLElement[];
    expect(opts.map(o => o.getAttribute('data-tube'))).toEqual(['smp-1', 'smp-2']);   // fixed order
    expect(opts[1].querySelector('.pf-sre-switch__tests')!.textContent).toContain('Bacterial Identification');
    opts[1].click();
    await f.whenStable();
    f.detectChanges();
    expect(c.activeTubeId()).toBe('smp-2');
    expect(el.querySelector('.pf-sre-switch__menu')).toBeNull();
    expect(el.querySelector('.pf-sre-chip--switch')!.textContent).toContain('26124');
  });

  it('a single tube: the sample chip is a plain chip — no chevron, not tappable', async () => {
    const { f, el, c } = await render();
    c._sample.update((s: any) => ({ ...s, siblings: [] }));
    c.syncTubeTabs(c._sample());
    f.detectChanges();
    expect(el.querySelector('.pf-sre-chip--switch')).toBeNull();
    const chip = el.querySelector('.pf-sre-chip--sample') as HTMLElement;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.querySelector('svg')).toBeNull();
    expect(chip.textContent).toContain('26123');
  });

  it('the patient name is FULL — never cut in code', async () => {
    const { el } = await render();
    const name = el.querySelector('.pf-sre-chip--patient .pf-sre-chip__name')!.textContent!.trim();
    expect(name).toBe(FULL_NAME);
    expect(el.textContent).not.toContain('..');
  });
});

describe('Result entry (nd) — RESULTS cards', () => {
  it('one nd-card per test: violet icon chip, the test name as the label, "+ Note" secondary', async () => {
    const { el } = await render();
    const cards = el.querySelectorAll('.pf-sre-main .nd-card.pf-sre-card');
    expect(cards.length).toBe(1);
    const head = cards[0].querySelector('.nd-card__head') as HTMLElement;
    expect(head.querySelector('.nd-card__icon svg')).not.toBeNull();
    expect(head.querySelector('.nd-card__label')!.textContent!.trim()).toBe('Bacterial PCR Detection');
    const note = head.querySelector('.pf-sre__note-btn') as HTMLElement;
    expect(note.textContent!.trim()).toBe('+ Note');
    expect(note.classList).toContain('nd-btn--secondary');
    expect(note.classList).not.toContain('nd-btn--primary');
  });

  it('the parameter table: 5 columns, one row per value, pf-select results, pencil = SVG icon button', async () => {
    const { el } = await render();
    const table = el.querySelector('.pf-sre-card .pf-sre__grid') as HTMLElement;
    const heads = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent!.trim());
    expect(heads).toEqual(['Parameter', 'Result', 'Reference range', 'Unit', 'Method']);
    const rows = table.querySelectorAll('tbody .pf-sre__grow');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('.pf-sre__gname')!.textContent).toContain('Target Detection');
    expect(rows[0].querySelector('.pf-sre__gc-method')!.textContent).toContain('Real-Time PCR');
    expect(rows[0].querySelector('pf-select')).not.toBeNull();
    const pencil = rows[0].querySelector('.pf-sre__gnote') as HTMLElement;
    expect(pencil.querySelector('svg')).not.toBeNull();
    expect(pencil.getAttribute('aria-label')).toContain('Target Detection');
    // No emoji / dingbat glyphs as icons, no row index numbers.
    expect(el.innerHTML).not.toMatch(/[✎↻⏳✓]/);
    expect(el.querySelector('.pf-sre__gidx')).toBeNull();
  });

  it('row style: 1px lines, name weight 500, range/unit/method muted, one font (no monospace)', () => {
    expect(css()).toMatch(/\.pf-sre__grow\s+td\s*\{[^}]*border-bottom:\s*1px solid var\(--nd-line\)/);
    expect(css()).toMatch(/\.pf-sre__gname\s*\{[^}]*font-weight:\s*500/);
    expect(css()).toMatch(/\.pf-sre__gc-unit,\s*\.pf-sre__gc-range,\s*\.pf-sre__gc-method\s*\{[^}]*color:\s*var\(--text-tertiary\)/);
    expect(css()).not.toMatch(/monospace/);
  });

});

describe('Result entry (nd) — no side panel', () => {
  it('RESULTS take the full width: no SAMPLE card, no split body, no sheet', async () => {
    const { el } = await render({ rich: true });
    expect(el.querySelector('aside')).toBeNull();
    expect(el.querySelector('.pf-sre-side')).toBeNull();
    expect(el.querySelector('.nd-body--split')).toBeNull();
    expect(el.querySelector('.nd-sheet, .nd-sheet-backdrop')).toBeNull();
    expect(el.querySelector('.pf-sre-body .pf-sre-main')).not.toBeNull();
    expect(el.textContent).not.toContain('parameters entered');
  });

  it('Trendogram (slate toggle) shows above the cards only when the patient has repeat tests', async () => {
    const { f, el, c } = await render();
    expect(el.querySelector('.pf-sre-strip')).toBeNull();
    c.trendEligible.set([{ testId: 't1', testName: 'X', count: 2, parameters: [] }]);
    f.detectChanges();
    const t = el.querySelector('.pf-sre-strip .nd-toggle[role="switch"]') as HTMLElement;
    expect(t.textContent).toContain('Include Trendogram');
    expect(t.getAttribute('aria-checked')).toBe('false');
  });
});

describe('Result entry (nd) — one-step notes', () => {
  it('the pencil opens a focused comment textarea at once; Enter saves', async () => {
    const { f, el } = await render();
    const api = TestBed.inject(ApiService) as any;
    const pencil = el.querySelector('.pf-sre__grow .pf-sre__gnote') as HTMLButtonElement;
    pencil.click();
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    const box = el.querySelector('textarea.pf-sre-quicknote') as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    expect(document.activeElement).toBe(box);          // one click → typing
    box.value = 'Haemolysed, re-run';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    expect(api.post).toHaveBeenCalledWith('/api/results/ot1/comments',
      expect.objectContaining({ parameterName: 'target', body: 'Haemolysed, re-run', commentType: 'observation' }));
    expect(el.querySelector('textarea.pf-sre-quicknote')).toBeNull();
  });

  it('Esc cancels without saving; an empty blur just closes', async () => {
    const { f, el } = await render();
    const api = TestBed.inject(ApiService) as any;
    (el.querySelector('.pf-sre__grow .pf-sre__gnote') as HTMLButtonElement).click();
    f.detectChanges();
    const box = el.querySelector('textarea.pf-sre-quicknote') as HTMLTextAreaElement;
    box.value = 'draft text';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(el.querySelector('textarea.pf-sre-quicknote')).toBeNull();
    expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining('/comments'), expect.anything());
  });

  it('"+ Note" on the card opens the same focused textarea (test-level note)', async () => {
    const { f, el } = await render();
    (el.querySelector('.pf-sre__note-btn') as HTMLButtonElement).click();
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    const box = el.querySelector('.pf-sre__test-note textarea.pf-sre-quicknote') as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    expect(document.activeElement).toBe(box);
  });
});

describe('Result entry (nd) — phone rows + type scale', () => {
  it('phones stack each row: name, then a FULL-WIDTH >=44px field, then range + unit', () => {
    const c = css();
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*grid-template-areas:\s*"param info act" "result result result"/);
    // No range / unit / method LINES on phones — they live in the peek.
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*td\.pf-sre__gc-range,\s*\.pf-sre__grow\s*>\s*td\.pf-sre__gc-unit\s*\{\s*display:\s*none\s*!important/);
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre__gc-method\s+\.pf-sre__method-t\s*\{\s*display:\s*none/);
    // The name never collapses: the first column is the full row width.
    expect(c).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    // Free text is a tall, growing box on phones.
    expect(c).toMatch(/\.pf-sre__gc-result\s+\.pf-sre__ginput--text\s*\{\s*min-height:\s*88px/);
    expect(c).toMatch(/\.pf-sre__gc-result\s+\.pf-sre__ginput\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px/);
  });

  it('phones: the "i" peek shows range, unit and method; auto-hides; closes on an outside tap', async () => {
    const { f, el } = await render();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const row = el.querySelector('.pf-sre__grow') as HTMLElement;
      const btn = row.querySelector('.pf-sre__gc-info .pf-sre__info-btn') as HTMLButtonElement;
      expect(btn.getAttribute('aria-label')).toBe('Details');
      btn.click();
      f.detectChanges();
      // A BODY-level portal: no card / scroller can clip it.
      const peek = document.body.querySelector(':scope > .pf-sre-peek') as HTMLElement;
      expect(peek).not.toBeNull();
      expect(peek.style.position).toBe('fixed');
      expect(row.querySelector('.pf-sre-peek')).toBeNull();
      expect(peek.textContent).toContain('Method');
      expect(peek.textContent).toContain('Real-Time PCR');
      // Auto-hides after ~4s.
      vi.advanceTimersByTime(4100);
      f.detectChanges();
      expect(document.body.querySelector('.pf-sre-peek')).toBeNull();
      // Re-open, then tap elsewhere.
      btn.click();
      f.detectChanges();
      expect(document.body.querySelector('.pf-sre-peek')).not.toBeNull();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      f.detectChanges();
      expect(document.body.querySelector('.pf-sre-peek')).toBeNull();
      // A second tap on the icon closes it.
      btn.click(); f.detectChanges();
      btn.dispatchEvent(new Event('pointerdown', { bubbles: true })); btn.click(); f.detectChanges();
      expect(document.body.querySelector('.pf-sre-peek')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('phones: the patient chip keeps the FULL name (meta → tooltip; wraps instead of an ellipsis)', async () => {
    const { el } = await render();
    const chip = el.querySelector('.pf-sre-chip--patient') as HTMLElement;
    expect(chip.getAttribute('title')).toBe('Mr. Sathish Kumaravel Ramasamy · 29/M · AA0012');
    expect(css()).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-chip--patient\s+\.pf-sre-chip__name\s*\{[^}]*white-space:\s*normal[^}]*text-overflow:\s*clip/);
    expect(css()).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-chip--patient\s+\.pf-sre-chip__meta\s*\{\s*display:\s*none/);
  });

  it('the "i" is hidden when a row has no range, unit or method', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('.pf-sre__grow');
    // Row 1 has a method; rows 2–3 have nothing to peek at.
    expect(rows[0].querySelector('.pf-sre__info-btn')).not.toBeNull();
    expect(rows[1].querySelector('.pf-sre__info-btn')).toBeNull();
    expect(rows[2].querySelector('.pf-sre__info-btn')).toBeNull();
    // Web keeps the columns: the info cell is phone-only.
    expect(css()).toMatch(/\.pf-sre__gc-info\s*\{\s*display:\s*none/);
  });

  it('the result field is a real box (visible border + background), never a bare caret', () => {
    expect(css()).toMatch(/\.pf-sre__ginput\s*\{[^}]*min-height:\s*40px[^}]*border:\s*1px solid color-mix[^}]*background:\s*color-mix/);
  });

  it('calm type scale: label 13px/600 (12px on phones), parameter 14px/500, chips + tabs 13px, buttons 14px', () => {
    const c = css();
    expect(c).toMatch(/\.pf-sre-card__label\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*600/);
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-card__label\s*\{\s*font-size:\s*12px\s*!important/);
    expect(c).toMatch(/\.pf-sre__gname\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*500/);
    expect(c).toMatch(/\.pf-sre-chip,\s*\.pf-sre-tab,\s*\.pf-sre-techchip\s*\{\s*font-size:\s*13px/);
    expect(c).toMatch(/\.pf-sre-act\s*\{\s*font-size:\s*14px/);
  });
});

describe('Result entry (nd) — zoom from the queue tile', () => {
  it('the first RESULTS card is the zoom target (keyed by the sample), unnamed at rest', async () => {
    const { el } = await render();
    const cards = Array.from(el.querySelectorAll('.pf-sre-main .pf-sre-card')) as HTMLElement[];
    expect(cards[0].getAttribute('data-zoom-target')).toBe('smp-1');
    expect(cards.slice(1).every(c => !c.getAttribute('data-zoom-target'))).toBe(true);
    expect(cards[0].style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('while the tube loads, the skeleton card is already the target (the tile morphs into it)', async () => {
    const { el, release } = await render({ hold: true });
    const skel = el.querySelector('.pf-sre-card--skel') as HTMLElement;
    expect(skel).not.toBeNull();
    expect(skel.getAttribute('data-zoom-target')).toBe('smp-1');
    release();
  });
});

describe('Result entry — switching drafts on the SAME route (draft shelf)', () => {
  const settle = async (f: any) => {
    for (let i = 0; i < 3; i++) { f.detectChanges(); await f.whenStable(); await new Promise(r => setTimeout(r, 0)); }
    f.detectChanges();
  };
  // An in-memory Storage (the runner's own localStorage may be missing).
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('tube A → tube B: the REUSED screen loads and shows B (reacts to the param, not a snapshot)', async () => {
    const { f, c, api, params$ } = await render();
    expect(c.sample().id).toBe('smp-1');
    params$.next(convertToParamMap({ sampleId: 'smp-2' }));
    await settle(f);
    expect(api.get).toHaveBeenCalledWith('/api/samples/smp-2/tests');
    expect(c.sample().id).toBe('smp-2');
    expect(c.sample().tests[0].name).toBe('Bacterial Identification');
    expect(c.activeTubeId()).toBe('smp-2');
    expect(c.loading()).toBe(false);
  });

  it("A's unsaved typing is saved BEFORE B loads (local copy + server draft), and B starts clean", async () => {
    const { f, c, api, params$ } = await render();
    c.setValue('ot1', 'target', 'Detected');           // debounced saves pending
    params$.next(convertToParamMap({ sampleId: 'smp-2' }));
    // Flushed synchronously on the switch — not left to the debounce.
    expect(JSON.parse(localStorage.getItem('pf-lms.sre-draft.smp-1')!)).toEqual({ ot1: { target: 'Detected' } });
    expect(api.post).toHaveBeenCalledWith('/api/samples/smp-1/results/draft',
      { results: [{ orderTestId: 'ot1', values: { target: 'Detected' }, note: undefined, bold: [] }] });
    await settle(f);
    expect(c.sample().id).toBe('smp-2');
    expect(c._values()['ot1']).toBeUndefined();           // A's typing never bleeds into B
    // …and coming back to A restores it.
    params$.next(convertToParamMap({ sampleId: 'smp-1' }));
    await settle(f);
    expect(c.sample().id).toBe('smp-1');
    expect(c.getValue('ot1', 'target')).toBe('Detected');
  });

  it('re-emitting the tube already on stage is a no-op: no refetch, typing kept', async () => {
    const { f, c, api, params$ } = await render();
    c.setValue('ot1', 'target', 'Detected');
    const gets = api.get.mock.calls.filter((a: unknown[]) => String(a[0]).endsWith('/tests')).length;
    params$.next(convertToParamMap({ sampleId: 'smp-1' }));
    await settle(f);
    expect(api.get.mock.calls.filter((a: unknown[]) => String(a[0]).endsWith('/tests')).length).toBe(gets);
    expect(c.getValue('ot1', 'target')).toBe('Detected');
    expect(api.post).not.toHaveBeenCalledWith('/api/samples/smp-1/results/draft', expect.anything());
  });

  it('leaving the screen (destroy) flushes pending typing too', async () => {
    const { f, c, api } = await render();
    c.setValue('ot1', 'adequacy', 'Adequate');
    f.destroy();
    expect(JSON.parse(localStorage.getItem('pf-lms.sre-draft.smp-1')!)).toEqual({ ot1: { adequacy: 'Adequate' } });
    expect(api.post).toHaveBeenCalledWith('/api/samples/smp-1/results/draft', expect.anything());
  });
});

describe('Result entry — Submit all (2+ tube tabs of one order)', () => {
  const settle = async (f: any) => {
    for (let i = 0; i < 4; i++) { f.detectChanges(); await f.whenStable(); await new Promise(r => setTimeout(r, 0)); }
    f.detectChanges();
  };
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  const FULL = { target: 'Detected', adequacy: 'Adequate', qc: 'Pass' };
  /** The sibling tube with a SAVED DRAFT on the server (currentResult). */
  const siblingWith = (values: Record<string, string> | null) => () => {
    const s = siblingFixture();
    if (values) s.tests[0].currentResult = JSON.stringify({ values });
    return s;
  };
  const resultPosts = (api: any) => api.post.mock.calls
    .map((a: unknown[]) => String(a[0])).filter((u: string) => /\/results$/.test(u));
  const clickSubmitAll = async (f: any, el: HTMLElement) => {
    (el.querySelector('pf-hero-band .pf-sre-submit-all') as HTMLButtonElement).click();
    await settle(f);
  };

  it('the band: "Submit all" is the ONE primary; "Submit this sample" is the secondary', async () => {
    const { f, el } = await render();
    await settle(f);
    const actions = el.querySelector('pf-hero-band .pf-hb__actions') as HTMLElement;
    const all = actions.querySelector('.pf-sre-submit-all') as HTMLButtonElement;
    const one = actions.querySelector('.pf-sre-submit-one') as HTMLButtonElement;
    expect(all.textContent!.trim()).toBe('Submit all');
    expect(all.classList).toContain('pf-hb-btn--primary');
    expect(all.getAttribute('aria-label')).toBe('Submit all');            // phones: the icon keeps the words
    expect(all.querySelector('svg.pf-sre-act__i')).not.toBeNull();
    expect(all.disabled).toBe(false);                                     // never silently disabled
    expect(one.textContent!.trim()).toBe('Submit this sample');
    expect(one.classList).toContain('pf-hb-btn--ghost');
    expect(one.querySelector('svg.pf-sre-act__i')).not.toBeNull();
    expect(actions.querySelectorAll('.pf-hb-btn--primary').length).toBe(1);
  });

  it('a single-tab order: "Submit results" posts only this tube; empty fields ask first (owner 2026-10-03)', async () => {
    const { f, el, c, api, dialog } = await render({ single: true, confirm: true });
    expect(el.querySelector('.pf-sre-submit-all, .pf-sre-submit-one')).toBeNull();
    c.setValue('ot1', 'target', 'Detected');                              // others left empty
    (el.querySelector('pf-hero-band .pf-sre-submit') as HTMLButtonElement).click();
    await settle(f);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);                      // was a silent partial submit
    expect((dialog.confirm.mock.calls[0] as any[])[0].title).toBe('Some fields are empty');
    expect(resultPosts(api)).toEqual(['/api/samples/smp-1/results']);
    expect(api.post).toHaveBeenCalledWith('/api/samples/smp-1/results',
      { results: [{ orderTestId: 'ot1', values: { target: 'Detected' }, note: undefined, bold: [] }] });
  });

  it('"Submit this sample" is the per-tab submit: only the open tube', async () => {
    const { f, el, c, api } = await render({ sibling: siblingWith(FULL) });
    await settle(f);
    for (const [k, v] of Object.entries(FULL)) c.setValue('ot1', k, v);
    (el.querySelector('pf-hero-band .pf-sre-submit-one') as HTMLButtonElement).click();
    await settle(f);
    expect(resultPosts(api)).toEqual(['/api/samples/smp-1/results']);
  });

  it('all fields filled: NO dialog; the unsaved typing is flushed first, then every tab is submitted', async () => {
    const { f, el, c, api, dialog, shelf, toasts, router } = await render({ sibling: siblingWith(FULL) });
    await settle(f);
    for (const [k, v] of Object.entries(FULL)) c.setValue('ot1', k, v);   // unsaved: debounces pending
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const done = c.submitAllTabs();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    const urls = api.post.mock.calls.map((a: unknown[]) => String(a[0]));
    // Local copy written + the server draft sent BEFORE any submit.
    expect(urls[0]).toBe('/api/samples/smp-1/results/draft');
    expect(urls.slice(1)).toEqual(['/api/samples/smp-1/results', '/api/samples/smp-2/results']);
    expect(dialog.confirm).not.toHaveBeenCalled();
    // The same per-tab payloads — the sibling's saved draft rides along.
    expect(api.post).toHaveBeenCalledWith('/api/samples/smp-1/results',
      { results: [{ orderTestId: 'ot1', values: FULL, note: undefined, bold: [] }] });
    expect(api.post).toHaveBeenCalledWith('/api/samples/smp-2/results',
      { results: [{ orderTestId: 'ot2', values: FULL, note: undefined, bold: [] }] });
    expect(toasts.success).toHaveBeenCalledWith('2 samples submitted — back to your queue');
    expect(shelf.drop).toHaveBeenCalledWith('lab', ['lab:smp-1', 'lab:smp-2']);
    expect(localStorage.getItem('pf-lms.sre-draft.smp-1')).toBeNull();
    await vi.advanceTimersByTimeAsync(700);
    expect(router.navigate).toHaveBeenCalledWith(['/lab/my-work']);
  });

  it('some fields empty: ONE confirmation listing them by tab and test', async () => {
    const { f, el, c, api, dialog } = await render({ sibling: siblingWith(null) });
    await settle(f);
    c.setValue('ot1', 'target', 'Detected');
    c.setValue('ot1', 'qc', 'Pass');
    await clickSubmitAll(f, el);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    const req = (dialog.confirm.mock.calls[0] as any[])[0];
    // The sibling's test has no value at all → named, and closed as not
    // reported on confirm (owner 2026-10-03).
    expect(req.title).toBe('1 test has no value');
    expect(req.message).toContain('Bacterial Identification');
    expect(req.items).toEqual([
      '26123 · Bacterial PCR Detection — Sample Adequacy',
      '26124 · Bacterial Identification — Target Detection, Sample Adequacy, Molecular QC',
    ]);
    expect(req.question).toBe('Submit without them?');
    expect(req.cancelLabel).toBe('Go back');
    expect(req.confirmLabel).toBe('Submit without them');
    expect(resultPosts(api)).toEqual([]);                                // "Go back" (the mock says no)
  });

  it('"Submit without them": filled tests go; a test with NO value is closed as not reported, never sent empty', async () => {
    const { f, el, c, api } = await render({ sibling: siblingWith(null), confirm: true });
    await settle(f);
    c.setValue('ot1', 'target', 'Detected');
    await clickSubmitAll(f, el);
    expect(resultPosts(api)).toEqual(['/api/samples/smp-1/results']);
    expect(api.post).toHaveBeenCalledWith('/api/samples/smp-1/results',
      { results: [{ orderTestId: 'ot1', values: { target: 'Detected' }, note: undefined, bold: [] }] });
    expect(api.post).toHaveBeenCalledWith('/api/samples/smp-2/not-reported', { orderTestIds: ['ot2'] });
  });

  it('"Go back" focuses the first empty field on the open tab', async () => {
    const { f, el, c, api } = await render({ sibling: siblingWith(FULL) });
    await settle(f);
    c.setValue('ot1', 'target', 'Detected');
    await clickSubmitAll(f, el);
    await settle(f);
    expect(resultPosts(api)).toEqual([]);
    const focused = document.activeElement as HTMLElement;
    expect(focused.closest('[data-sre-param]')!.getAttribute('data-sre-param')).toBe('ot1::adequacy');
  });

  it('"Go back" switches to the first tab with an empty field and focuses it', async () => {
    const { f, el, c, router } = await render({ sibling: siblingWith({ target: 'Detected' }) });
    await settle(f);
    for (const [k, v] of Object.entries(FULL)) c.setValue('ot1', k, v);
    await clickSubmitAll(f, el);
    await settle(f);
    expect(router.navigate).toHaveBeenCalledWith(['/lab/sample', 'smp-2'], expect.anything());
    expect(c.sample().id).toBe('smp-2');
    const focused = document.activeElement as HTMLElement;
    expect(focused.closest('[data-sre-param]')!.getAttribute('data-sre-param')).toBe('ot2::adequacy');
  });

  it('partial failure: reported per tab, the failed tab keeps its data and is the one on screen', async () => {
    const { f, el, c, api, shelf, toasts, router } = await render({
      sibling: siblingWith(FULL),
      post: (url: string) => url === '/api/samples/smp-2/results'
        ? throwError(() => ({ error: { message: 'Sample has not been collected yet.' } }))
        : of({}),
    });
    await settle(f);
    localStorage.setItem('pf-lms.sre-draft.smp-2', JSON.stringify({ ot2: { qc: 'Fail' } }));
    for (const [k, v] of Object.entries(FULL)) c.setValue('ot1', k, v);
    await clickSubmitAll(f, el);
    expect(resultPosts(api)).toEqual(['/api/samples/smp-1/results', '/api/samples/smp-2/results']);
    expect(toasts.error).toHaveBeenCalledWith('26123 submitted · 26124 failed: Sample has not been collected yet.');
    expect(toasts.success).not.toHaveBeenCalled();
    expect(shelf.drop).toHaveBeenCalledWith('lab', ['lab:smp-1']);
    expect(router.navigate).not.toHaveBeenCalledWith(['/lab/my-work']);
    // Stays on (moves to) the failed tube, its typing intact.
    expect(c.sample().id).toBe('smp-2');
    expect(c.getValue('ot2', 'qc')).toBe('Fail');
    const report = Array.from(el.querySelectorAll('.pf-sre-report li')).map(li => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(report).toEqual(['26123 · Submitted', '26124 · Not submitted — Sample has not been collected yet.']);
  });
});
