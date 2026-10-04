import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ResultEntryComponent } from './result-entry.component';
import { ApiService } from '../../../core/services/api.service';
import { ScanService } from '../../../core/services/scan.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';
import type { ReportNotesView } from '../../../shared/components/report-note/report-notes.store';

/**
 * Per-test result entry × technician report notes (owner 2026-09-30): the
 * "Report notes" card lists THIS test's note, its profile's, its section's
 * and the whole report's — the profile member gets its own note, not only
 * the profile. Switch off → no card (unless a note already exists).
 */
const PARAMS = JSON.stringify({ parameters: [{ name: 'alt', title: 'SGPT (ALT)', type: 'numeric', unit: 'U/L' }] });

const view = (enabled: boolean): ReportNotesView => ({
  enabled, maxLength: 1000,
  order: { id: null, name: 'Overall report note', text: null, editable: true },
  departments: [{ id: 'd1', name: 'Biochemistry', text: null, editable: true }],
  profiles: [{ id: 'lft', name: 'Liver Function Test', text: null, editable: true }],
  tests: [
    { id: 'ot1', name: 'SGPT (ALT)', profileId: 'lft', departmentId: 'd1', status: 'in_progress', text: null, editable: true },
    { id: 'ot2', name: 'SGOT (AST)', profileId: 'lft', departmentId: 'd1', status: 'in_progress', text: null, editable: true },
  ],
});

async function render(notes: ReportNotesView) {
  const ot = {
    id: 'ot1', subOrderId: 's1', testId: 't1', status: 'in_progress',
    subOrder: { id: 's1', orderId: 'o1', barcode: '26123', order: { id: 'o1', patient: { id: 'p1', displayName: 'Demo Patient', sex: 'M', age: 40 } } },
    test: { id: 't1', name: 'SGPT (ALT)', parameters: PARAMS },
  };
  const api = {
    get: vi.fn((url: string) => url === '/api/results/ot1' ? of(ot)
      : url === '/api/orders/o1/report-notes' ? of(notes) : of([])),
    post: vi.fn(() => of({})), put: vi.fn(() => of(notes)), patch: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ScanService, useValue: { manualEntry: () => true } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false), prompt: vi.fn() } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Demo Lab' }), ensureLoaded() {} } },
      { provide: AuthService, useValue: { user: () => ({ displayName: 'Admin User' }), hasPermission: () => true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'ot1' }), queryParamMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({ id: 'ot1' })), queryParamMap: of(convertToParamMap({})) } },
      { provide: Router, useValue: { url: '/lab/result/ot1', navigate: vi.fn(() => Promise.resolve(true)), getCurrentNavigation: () => null } },
    ],
  });
  const f = TestBed.createComponent(ResultEntryComponent);
  f.detectChanges();
  for (let i = 0; i < 4; i++) { await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges(); }
  return { f, el: f.nativeElement as HTMLElement, api };
}

afterEach(() => TestBed.resetTestingModule());

describe('Result entry (per test) — technician report notes', () => {
  it('lists this member test, its profile, its section and the whole report — not the sibling', async () => {
    const { el, api } = await render(view(true));
    expect(api.get).toHaveBeenCalledWith('/api/orders/o1/report-notes');
    const rows = [...el.querySelectorAll('.pf-rnc [data-rnc]')].map(r => r.getAttribute('data-rnc'));
    expect(rows).toEqual(['test:ot1', 'profile:lft', 'department:d1', 'order:']);
    expect(el.querySelectorAll('.pf-rnc .pf-rns__add').length).toBe(4);
  });

  it('opening a slot shows the editor for THAT note; save PUTs it', async () => {
    const { el, f, api } = await render(view(true));
    el.querySelector<HTMLButtonElement>('.pf-rnc [data-rnc="profile:lft"] .pf-rns__add')!.click();
    f.detectChanges();
    const ta = el.querySelector<HTMLTextAreaElement>('.pf-rnc [data-rnc="profile:lft"] textarea')!;
    expect(ta.getAttribute('aria-label')).toBe('Report note — Liver Function Test');
    ta.value = '- repeat LFT in 2 weeks';
    ta.dispatchEvent(new Event('input'));
    f.detectChanges();
    el.querySelector<HTMLButtonElement>('.pf-rnc [data-rnc="profile:lft"] .pf-rne__save')!.click();
    await f.whenStable();
    expect(api.put).toHaveBeenCalledWith('/api/orders/o1/report-notes', { scope: 'profile', key: 'lft', text: '- repeat LFT in 2 weeks' });
  });

  it('switch off and nothing written → no card', async () => {
    const { el } = await render(view(false));
    expect(el.querySelector('.pf-rnc')).toBeNull();
  });
});
