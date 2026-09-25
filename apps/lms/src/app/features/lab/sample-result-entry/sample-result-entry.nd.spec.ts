import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { SampleResultEntryComponent } from './sample-result-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { PlatformService } from '../../../core/services/platform.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

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

async function render(opts: { rich?: boolean; hold?: boolean } = {}) {
  const sample = sampleFixture(!!opts.rich);
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const api = {
    get: vi.fn((url: string) => {
      if (url.endsWith('/smp-2/tests')) return of(siblingFixture());
      if (url.endsWith('/tests')) return opts.hold ? { subscribe: (o: any) => { gate.then(() => o.next(sample)); return { unsubscribe() {} }; } } as any : of(sample);
      if (url.includes('lab-trends')) return of({ tests: [] });
      return of([]);
    }),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', registrationId: '123434', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: DialogService, useValue: {} },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), url: '/lab/sample/smp-1' } },
    ],
  });
  const f = TestBed.createComponent(SampleResultEntryComponent);
  f.detectChanges();
  if (!opts.hold) {
    await f.whenStable();
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
  }
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, release };
}

/** Component CSS with Angular's scoping attributes stripped. */
const css = () => ((SampleResultEntryComponent as any).ɵcmp.styles as string[]).join('\n')
  .replace(/\[_ng(content|host)-%COMP%\]/g, '');

describe('Result entry (nd) — band + CONTEXT BAR', () => {
  it('the band keeps back + tenant; the pill carries ONLY the patient (no current-sample chip)', async () => {
    const { el } = await render();
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
    // The old big header block is gone.
    expect(el.querySelector('.pf-sre__hdr')).toBeNull();
    expect(el.querySelector('.pf-sre__title')).toBeNull();

    const ctx = el.querySelector('pf-hero-band .pf-sre-ctx') as HTMLElement;
    expect(ctx).not.toBeNull();
    expect(ctx.querySelector('.pf-sre-chip--patient .pf-sre-chip__meta')!.textContent!.trim()).toBe('29/M · AA0012');
    // The tabs already say which tube is open — no separate sample chip.
    expect(el.querySelector('.pf-sre-chip--sample')).toBeNull();
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
    // Phones: compact (initials, Reg in the tooltip) in the bottom bar.
    const barChip = el.querySelector('.pf-sre-bar .pf-sre-techchip') as HTMLElement;
    expect(barChip.textContent!.trim()).toBe('AU');
    expect(barChip.getAttribute('title')).toContain('123434');

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
    const { el } = await render();
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
    const { f, el, c } = await render();
    c._sample.update((s: any) => ({ ...s, tests: s.tests.map((t: any) => ({ ...t, status: 'validated' })) }));
    f.detectChanges();
    const submit = el.querySelector('pf-hero-band .pf-sre-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(el.querySelector('pf-hero-band .pf-sre-draft')).toBeNull();
  });

  it('phones: the same two actions in a compact bottom bar above the navbar', async () => {
    const { el } = await render();
    const bar = el.querySelector('.nd-bottombar.pf-sre-bar') as HTMLElement;
    expect(bar.querySelector('.pf-sre-draft')!.textContent!.trim()).toBe('Save draft');
    expect(bar.querySelector('.pf-sre-submit')!.textContent!.trim()).toBe('Submit results');
    expect(css()).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-band\s+\.pf-sre-act[^{]*\{\s*display:\s*none/);
  });

  it('sample tabs: this tube + siblings as a neutral segmented control; open work = violet dot', async () => {
    const { el } = await render();
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
    expect(items[1].querySelector('.pf-sre-tab__dot')).not.toBeNull();
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
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*grid-template-areas:\s*"param method note" "result result result" "range range unit"/);
    expect(c).toMatch(/\.pf-sre__gc-result\s+\.pf-sre__ginput\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px/);
  });

  it('the result field is a real box (visible border + background), never a bare caret', () => {
    expect(css()).toMatch(/\.pf-sre__ginput\s*\{[^}]*min-height:\s*40px[^}]*border:\s*1px solid color-mix[^}]*background:\s*color-mix/);
  });

  it('calm type scale: label 13px/600 (12px on phones), parameter 14px/500, chips + tabs 13px, buttons 14px', () => {
    const c = css();
    expect(c).toMatch(/\.pf-sre-card__label\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*600/);
    expect(c).toMatch(/@media \(max-width: 640px\)[\s\S]*\.pf-sre-card__label\s*\{\s*font-size:\s*12px/);
    expect(c).toMatch(/\.pf-sre__gname\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*500/);
    expect(c).toMatch(/\.pf-sre-chip,\s*\.pf-sre-tab,\s*\.pf-sre-techchip\s*\{\s*font-size:\s*13px/);
    expect(c).toMatch(/\.pf-sre-act\s*\{\s*font-size:\s*14px/);
  });
});

describe('Result entry (nd) — zoom from the queue tile', () => {
  it('the first RESULTS card carries view-transition-name sample-<id>', async () => {
    const { el } = await render();
    const card = el.querySelector('.pf-sre-main .pf-sre-card') as HTMLElement;
    expect(card.style.getPropertyValue('view-transition-name')).toBe('sample-smp-1');
  });

  it('while the tube loads, the skeleton card already carries it (the tile morphs into it)', async () => {
    const { el, release } = await render({ hold: true });
    const skel = el.querySelector('.pf-sre-card--skel') as HTMLElement;
    expect(skel).not.toBeNull();
    expect(skel.style.getPropertyValue('view-transition-name')).toBe('sample-smp-1');
    release();
  });
});
