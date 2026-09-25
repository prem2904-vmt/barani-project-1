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
 * band + CONTEXT BAR, one RESULTS card per test, the SAMPLE side card with
 * ONE primary, and the zoom name shared with the queue tile.
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

async function render(opts: { rich?: boolean; hold?: boolean } = {}) {
  const sample = sampleFixture(!!opts.rich);
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const api = {
    get: vi.fn((url: string) => {
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
  it('the band keeps back + tenant; the pill carries patient, sample, tabs, technician, Grid/Form', async () => {
    const { el } = await render();
    expect(el.querySelector('pf-hero-band')).not.toBeNull();
    // The old big header block is gone.
    expect(el.querySelector('.pf-sre__hdr')).toBeNull();
    expect(el.querySelector('.pf-sre__title')).toBeNull();

    const ctx = el.querySelector('pf-hero-band .pf-sre-ctx') as HTMLElement;
    expect(ctx).not.toBeNull();
    expect(ctx.querySelector('.pf-sre-chip--patient .pf-sre-chip__meta')!.textContent!.trim()).toBe('29/M · AA0012');
    const sampleChip = ctx.querySelector('.pf-sre-chip--sample') as HTMLElement;
    expect(sampleChip.textContent).toContain('26123');
    expect(sampleChip.textContent).toContain('MOL');
    expect(sampleChip.querySelector('.pf-sre-chip__id')!.classList).toContain('nd-num');
    expect(ctx.querySelector('.pf-sre-chip--tech')!.textContent).toContain('Admin User');
    expect(ctx.querySelector('.pf-sre-chip--tech')!.textContent).toContain('123434');

    const mode = el.querySelector('pf-hero-band .pf-sre-mode') as HTMLElement;
    expect(mode.classList).toContain('nd-seg');
    const on = mode.querySelector('.nd-seg__item[aria-checked="true"]')!;
    expect(on.textContent!.trim()).toBe('Grid');
  });

  it('sample tabs: this tube + siblings as a neutral segmented control; open work = violet dot', async () => {
    const { el } = await render();
    const tabs = el.querySelector('.pf-sre-ctx .pf-sre-tabs') as HTMLElement;
    expect(tabs.classList).toContain('nd-seg');
    const items = tabs.querySelectorAll('[role="tab"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('aria-selected')).toBe('true');
    expect(items[0].textContent).toContain('26123');
    expect(items[1].textContent).toContain('26124');
    expect(items[1].textContent).toContain('Bacterial Identification');
    expect(items[1].querySelector('.pf-sre-tab__dot')).not.toBeNull();
    expect(css()).toMatch(/\.pf-sre-tab__dot[^{]*\{[^}]*background:\s*var\(--color-violet-500/);
    // Phones: the same tubes as one pf-select (never a native <select>).
    expect(el.querySelector('pf-select.pf-sre-tubesel')).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();
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

  it('Grid / Form stay: Form renders the same test as a labelled field card', async () => {
    const { f, el, c } = await render();
    c.setViewMode('form');
    f.detectChanges();
    expect(el.querySelectorAll('.pf-sre-card .pf-sre__param').length).toBe(3);
    expect(el.querySelector('.pf-sre-mode .nd-seg__item[aria-checked="true"]')!.textContent!.trim()).toBe('Form');
    c.setViewMode('grid');
  });
});

describe('Result entry (nd) — SAMPLE side card', () => {
  it('shows only what the cards do not: specimen, container, times, TAT/due, order, referrer', async () => {
    const { el } = await render({ rich: true });
    const side = el.querySelector('aside.nd-card.pf-sre-side') as HTMLElement;
    expect(side.querySelector('.nd-card__label')!.textContent!.trim()).toBe('Sample');
    const dts = Array.from(side.querySelectorAll('.pf-sre-info__row dt')).map(d => d.textContent!.trim());
    expect(dts).toEqual(['Specimen', 'Container', 'Collected', 'Received', 'TAT', 'Order', 'Referred by']);
    expect(side.textContent).toContain('Nasal swab');
    expect(side.textContent).toContain('Sterile Container');
    expect(side.textContent).toContain('Dr. Meera Rao');
    expect(side.textContent).toContain('24 h');
    // No repetition of the RESULTS card (no per-parameter list here).
    expect(side.textContent).not.toContain('Target Detection');
  });

  it('never invents: a bare tube shows no info rows at all', async () => {
    const { el } = await render({ rich: false });
    const side = el.querySelector('aside.pf-sre-side') as HTMLElement;
    expect(side.querySelectorAll('.pf-sre-info__row').length).toBe(0);
    expect(side.querySelector('.pf-sre-prev')).toBeNull();
    expect(side.textContent).not.toContain('Referred by');
  });

  it('carries ONE status line with the entry progress', async () => {
    const { f, el, c } = await render();
    expect(el.querySelector('.pf-sre-status')!.textContent).toContain('0 of 3 parameters entered');
    c.setValue('ot1', 'target', 'Detected');
    f.detectChanges();
    expect(el.querySelector('.pf-sre-status')!.textContent).toContain('1 of 3 parameters entered');
    c.clearDraft?.();
  });

  it('footer: secondary Save draft + ONE primary Submit results, normal size (not full width)', async () => {
    const { el } = await render();
    const foot = el.querySelector('aside.pf-sre-side .nd-card__foot') as HTMLElement;
    expect(foot.classList).toContain('pf-sre-foot');
    const primaries = foot.querySelectorAll('.nd-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].textContent!.trim()).toBe('Submit results');
    expect(primaries[0].classList).not.toContain('nd-span');
    expect(foot.querySelector('.nd-btn--secondary')!.textContent!.trim()).toBe('Save draft');
    // The footer is a right-aligned flex row, so buttons keep their size.
    expect(css()).toMatch(/\.nd-card__foot\.pf-sre-foot\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*flex-end/);
    // The old huge gradient bar is gone.
    expect(el.querySelector('.pf-sre__footer')).toBeNull();
  });

  it('phones: the SAMPLE card is the bottom bar + sheet', async () => {
    const { f, el, c } = await render();
    const bar = el.querySelector('.nd-bottombar.pf-sre-bar') as HTMLElement;
    expect(bar.querySelector('.nd-bottombar__info')!.textContent).toContain('of 3 parameters entered');
    (bar.querySelector('.nd-btn--icon') as HTMLElement).click();
    f.detectChanges();
    expect(c.sheetOpen()).toBe(true);
    expect(el.querySelector('aside.pf-sre-side')!.classList).toContain('pf-sre-side--open');
    expect(el.querySelector('.nd-sheet-backdrop')).not.toBeNull();
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
