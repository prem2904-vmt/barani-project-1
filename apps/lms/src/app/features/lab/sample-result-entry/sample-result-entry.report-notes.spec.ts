import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
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
import type { ReportNotesView } from '../../../shared/components/report-note/report-notes.store';

/**
 * Owner 2026-09-30 — technician notes on the report, on the tube's result
 * entry: a "report note" affordance on each test (card header / row
 * actions), the profile block header, and a "Report notes" card for the
 * tube's department sections + the whole report. The Lab-settings switch
 * (server `enabled`) hides every editor; a saved note still shows read-only.
 */
const TWO = JSON.stringify({ parameters: [
  { name: 'Hb', title: 'Haemoglobin', type: 'numeric', unit: 'g/dL' },
  { name: 'PCV', title: 'Packed Cell Volume', type: 'numeric', unit: '%' },
] });
const ONE = JSON.stringify({ parameters: [{ name: 'ESR', title: 'ESR', type: 'numeric', unit: 'mm/hr' }] });

function sampleFixture(status = 'in_progress'): any {
  return {
    id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0,
    createdAt: '2026-09-25T03:00:00Z',
    department: { id: 'd1', name: 'Haematology', code: 'HEM' },
    order: {
      id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open',
      collectionType: 'walkin', createdAt: '2026-09-25T03:00:00Z', samples: [],
      patient: { id: 'p1', displayName: 'Test Patient', age: 29, sex: 'Male', mrn: 'AA0012' },
    },
    siblings: [],
    tests: [
      { id: 'ot1', subOrderId: 'smp-1', testId: 't1', status, test: { id: 't1', name: 'Haemogram', parameters: TWO } },
      { id: 'ot2', subOrderId: 'smp-1', testId: 't2', status, test: { id: 't2', name: 'ESR', parameters: ONE } },
    ],
  };
}

function view(enabled: boolean, editable: boolean, texts: Partial<Record<'ot1' | 'dept' | 'order', string>> = {}): ReportNotesView {
  return {
    enabled, maxLength: 1000,
    order: { id: null, name: 'Overall report note', text: texts.order ?? null, editable },
    departments: [{ id: 'd1', name: 'Haematology', text: texts.dept ?? null, editable }],
    profiles: [],
    tests: [
      { id: 'ot1', name: 'Haemogram', profileId: null, departmentId: 'd1', status: 'in_progress', text: texts.ot1 ?? null, editable },
      { id: 'ot2', name: 'ESR', profileId: null, departmentId: 'd1', status: 'in_progress', text: null, editable },
    ],
  };
}

async function render(notes: ReportNotesView, status = 'in_progress', query: Record<string, string> = {}) {
  const sample = sampleFixture(status);
  const api = {
    get: vi.fn((url: string) => {
      if (url.endsWith('/tests')) return of(sample);
      if (url.includes('lab-trends')) return of({ tests: [] });
      if (url === '/api/orders/o1/report-notes') return of(notes);
      return of([]);
    }),
    post: vi.fn(() => of({ sample, submitted: 1, results: [] })),
    patch: vi.fn(() => of({})),
    put: vi.fn((url: string, body: any) => url.endsWith('/report-notes')
      ? of({ ...notes, tests: notes.tests.map(t => t.id === body.key ? { ...t, text: body.text || null } : t) })
      : of({})),
  };
  const params$ = new BehaviorSubject(convertToParamMap({ sampleId: 'smp-1' }));
  const query$ = new BehaviorSubject(convertToParamMap(query));
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true), prompt: vi.fn() } },
      { provide: DraftShelfService, useValue: { drop: vi.fn() } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ActivatedRoute, useValue: { paramMap: params$, queryParamMap: query$,
        snapshot: { paramMap: new Map([['sampleId', 'smp-1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: { url: '/lab/sample/smp-1', navigate: vi.fn(() => Promise.resolve(true)) } },
    ],
  });
  const f = TestBed.createComponent(SampleResultEntryComponent);
  f.detectChanges();
  await f.whenStable();
  for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); }
  return { f, el: f.nativeElement as HTMLElement, api };
}

const noteBtn = (el: HTMLElement, key: string) => el.querySelector<HTMLButtonElement>(`[data-rnb="${key}"]`);

describe('Result entry — technician report notes', () => {
  afterEach(() => { TestBed.resetTestingModule(); try { localStorage.clear(); } catch { /* */ } });

  it('switch OFF and nothing written → no note affordance, no notes card', async () => {
    const { el, api } = await render(view(false, true));
    expect(api.get).toHaveBeenCalledWith('/api/orders/o1/report-notes');
    expect(el.querySelector('pf-report-note-button button')).toBeNull();
    expect(el.querySelector('.pf-rnc')).toBeNull();
    expect(el.querySelector('pf-report-note-editor')).toBeNull();
  });

  it('switch ON → a report-note button on each test (card header + row), and a card for the section + whole report', async () => {
    const { el } = await render(view(true, true));
    expect(noteBtn(el, 'test:ot1')).not.toBeNull();          // Haemogram card header
    expect(noteBtn(el, 'test:ot2')).not.toBeNull();          // ESR row actions
    const card = el.querySelector('.pf-rnc')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-rnc="department:d1"]')!.textContent).toContain('Haematology');
    expect(card.querySelector('[data-rnc="order:"]')!.textContent).toContain('Whole report');
    // ND: no native controls, SVG icons only.
    expect(el.querySelector('.pf-rnc select, .pf-rnc datalist')).toBeNull();
  });

  it('writing a line note: open → type → Save sends it to the order, then shows it read-only', async () => {
    const { el, f, api } = await render(view(true, true));
    noteBtn(el, 'test:ot1')!.click();
    f.detectChanges();
    const ta = el.querySelector<HTMLTextAreaElement>('pf-report-note-editor textarea')!;
    expect(ta.getAttribute('aria-label')).toBe('Report note — Haemogram');
    ta.value = '**Haemolysed** — _repeat_';
    ta.dispatchEvent(new Event('input'));
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('pf-report-note-editor .pf-rne__save')!.click();
    await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    expect(api.put).toHaveBeenCalledWith('/api/orders/o1/report-notes', { scope: 'test', key: 'ot1', text: '**Haemolysed** — _repeat_' });
    expect(el.querySelector('pf-report-note-editor')).toBeNull();
    const saved = el.querySelector('.pf-rns__saved')!;
    expect(saved.querySelector('.pf-rnv__b')!.textContent).toBe('Haemolysed');
    expect(saved.querySelector('.pf-rnv__i')!.textContent).toBe('repeat');
  });

  it('switch OFF but a note was saved → it shows read-only (it still prints), no Edit', async () => {
    const { el } = await render(view(false, true, { ot1: '**kept**', order: 'Whole-report note' }));
    const saved = el.querySelector('.pf-rns__saved')!;
    expect(saved.textContent).toContain('kept');
    expect(saved.querySelector('.pf-rns__edit')).toBeNull();
    expect(el.querySelector('pf-report-note-button button')).toBeNull();
    const card = el.querySelector('.pf-rnc')!;
    expect(card.textContent).toContain('Technician notes are off in Lab settings');
    expect(card.querySelector('[data-rnc="order:"]')!.textContent).toContain('Whole-report note');
    expect(card.querySelector('[data-rnc="department:d1"]')).toBeNull();   // nothing there to show
  });

  it('a validated tube (server: not editable) → notes read-only, no add buttons', async () => {
    const { el } = await render(view(true, false, { dept: 'Section note' }), 'validated');
    expect(el.querySelector('pf-report-note-button button')).toBeNull();
    expect(el.querySelector('.pf-rns__add')).toBeNull();
    expect(el.querySelector('.pf-rnc [data-rnc="department:d1"]')!.textContent).toContain('Section note');
  });

  // Owner 2026-09-30: the validator sees the notes when they view the case —
  // the tube's validate mode (?validate=1) shows every level that prints.
  it('validate mode: every note that will print is visible; editable while the server says so', async () => {
    const { el } = await render(view(true, true, { ot1: '**Haemolysed**', dept: 'Section note', order: 'Whole note' }),
      'entered', { validate: '1' });
    const lineNote = el.querySelector('.pf-rns__saved')!;
    expect(lineNote.querySelector('.pf-rnv__b')!.textContent).toBe('Haemolysed');
    expect(lineNote.querySelector('.pf-rns__edit')).not.toBeNull();          // awaiting validation → adjustable
    expect(noteBtn(el, 'test:ot2')).not.toBeNull();
    const card = el.querySelector('.pf-rnc')!;
    expect(card.textContent).toContain('final report');
    expect(card.querySelector('[data-rnc="department:d1"]')!.textContent).toContain('Section note');
    expect(card.querySelector('[data-rnc="order:"]')!.textContent).toContain('Whole note');
  });

  it('validate mode on a signed-off tube: the notes stay visible, read-only', async () => {
    const { el } = await render(view(true, false, { ot1: '_kept_', dept: 'Section note', order: 'Whole note' }),
      'validated', { validate: '1' });
    expect(el.querySelector('.pf-rns__saved .pf-rnv__i')!.textContent).toBe('kept');
    expect(el.querySelector('.pf-rns__edit')).toBeNull();
    expect(el.querySelector('pf-report-note-button button')).toBeNull();
    expect(el.querySelector('.pf-rnc [data-rnc="department:d1"]')!.textContent).toContain('Section note');
    expect(el.querySelector('.pf-rnc [data-rnc="order:"]')!.textContent).toContain('Whole note');
  });
});
