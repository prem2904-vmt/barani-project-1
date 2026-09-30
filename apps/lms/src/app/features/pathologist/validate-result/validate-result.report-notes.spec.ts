import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ValidateResultComponent } from './validate-result.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { PlatformService } from '../../../core/services/platform.service';
import type { ReportNotesView } from '../../../shared/components/report-note/report-notes.store';

/**
 * Owner 2026-09-30: the pathologist sees the technician notes that will
 * print (line, profile, section, whole report) in the validation rail; while
 * a line awaits validation the server keeps it editable, after that it is
 * read-only.
 */
const param = { name: 'hb', title: 'Hb', unit: 'g/dL', referenceRanges: [{ min: 12, max: 15 }] };
const ot = (id: string) => ({
  id, status: 'entered',
  currentResult: JSON.stringify({ values: { hb: '13' } }),
  test: { name: 'Haemoglobin', parameters: JSON.stringify({ parameters: [param] }), department: { id: 'd1', name: 'Haematology' } },
  subOrder: { id: 's1', orderId: 'o1', order: { id: 'o1', patientId: 'p1', patient: { id: 'p1', displayName: 'Priya Nair', sex: 'Female', age: 30 } } },
});

const notes = (editable: boolean): ReportNotesView => ({
  enabled: true, maxLength: 1000,
  order: { id: null, name: 'Overall report note', text: 'Overall **ok**', editable },
  departments: [{ id: 'd1', name: 'Haematology', text: null, editable }],
  profiles: [],
  tests: [{ id: 't1', name: 'Haemoglobin', profileId: null, departmentId: 'd1', status: 'entered', text: '_Haemolysed_ sample', editable }],
});

afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

async function render(view: ReportNotesView) {
  const api = {
    get: vi.fn((url: string) => url.startsWith('/api/validation/queue') ? of([ot('t1')])
      : url === '/api/orders/o1/report-notes' ? of(view) : of([])),
    post: vi.fn(() => of({})), patch: vi.fn(() => of({})), put: vi.fn(() => of(view)),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { prompt: vi.fn(), confirm: vi.fn(async () => false), choose: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', displayName: 'Dr A' }), hasPermission: () => true, hasAnyPermission: () => true } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 't1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: { url: '/pathologist/validate/t1', navigate: vi.fn(() => Promise.resolve(true)), events: of() } },
    ],
  });
  const f = TestBed.createComponent(ValidateResultComponent);
  f.detectChanges();
  for (let i = 0; i < 4; i++) { await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges(); }
  return { f, el: f.nativeElement as HTMLElement, api };
}

describe('Validate — technician report notes', () => {
  it('the rail lists what will print — the line note formatted, the whole-report note', async () => {
    const { el, api } = await render(notes(true));
    expect(api.get).toHaveBeenCalledWith('/api/orders/o1/report-notes');
    const card = el.querySelector('.pf-rnc')!;
    expect(card).not.toBeNull();
    const line = card.querySelector('[data-rnc="test:t1"]')!;
    expect(line.querySelector('.pf-rnv__i')!.textContent).toBe('Haemolysed');
    expect(card.querySelector('[data-rnc="order:"] .pf-rnv__b')!.textContent).toBe('ok');
    // Awaiting validation: the reviewer may still adjust it.
    expect(line.querySelector('.pf-rns__edit')).not.toBeNull();
  });

  it('once validated (server: not editable) the notes are read-only', async () => {
    const { el } = await render(notes(false));
    const card = el.querySelector('.pf-rnc')!;
    expect(card.querySelector('.pf-rns__edit')).toBeNull();
    expect(card.querySelector('.pf-rns__add')).toBeNull();
    expect(card.querySelector('[data-rnc="department:d1"]')).toBeNull();   // empty + frozen → nothing to show
  });
});
