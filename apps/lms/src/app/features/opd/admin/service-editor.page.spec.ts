import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { OpdAdminApi, OpdServiceRow } from './opd-admin.api';
import { OpdServiceEditorPage } from './service-editor.page';

/**
 * OPD service editor — new service codes follow the department, per-doctor
 * fee rows save after the service, the desk preview shows what each doctor
 * is charged (new visit + follow-up), and there is no fallback price.
 */
const SVC: OpdServiceRow = {
  id: 's1', departmentId: 'ent', name: 'ENT consultation', code: 'ENT-C01', category: 'consultation', priceMode: 'per_doctor',
  commonPrice: 0, taxSlab: 0, followUpWithinDays: 7, followUpFee: 250, sortOrder: 1, isActive: true,
  doctorPrices: [{ doctorUserId: 'd1', price: 600, followUpFee: 300, isActive: true }],
};

function render(id: string, q: Record<string, string> = {}) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    departments: vi.fn(() => of([{ id: 'ent', name: 'ENT', code: 'ENT', defaultFormId: 'f1', sortOrder: 1, isActive: true }])),
    forms: vi.fn(() => of([{ id: 'f1', name: 'ENT assessment', code: 'e', isActive: true, publishedVersion: 1, questionCount: 2, usedByServices: 1, usedByDepartments: 1, updatedAt: '' }])),
    doctors: vi.fn(() => of([
      { userId: 'd1', name: 'Dr Rao', specializations: ['ENT'], fee: 0, days: ['mon', 'tue', 'wed'], prices: [] },
      { userId: 'd2', name: 'Dr Menon', specializations: [], fee: 0, days: [], prices: [] },
    ])),
    services: vi.fn(() => of([SVC])),
    service: vi.fn(() => of(SVC)),
    form: vi.fn(() => of({ id: 'f1', name: 'ENT assessment', code: 'e', isActive: true, versions: [], usedBy: [],
      published: { id: 'v1', formId: 'f1', version: 1, status: 'published', createdAt: '',
        schema: { schemaVersion: 2, sections: [{ key: 'findings', title: 'Findings', fields: [{ key: 'cc', label: 'Chief complaints', type: 'short', required: true }] }] } } })),
    saveServices: vi.fn((rows: OpdServiceRow[]) => of(rows.map((r) => ({ ...r, id: r.id ?? 'new1', doctorPrices: [] })))),
    saveDoctorPrices: vi.fn((sid: string, rows: unknown[]) => of({ ...SVC, id: sid, doctorPrices: rows })),
  };
  const router = { navigate: vi.fn() };
  TestBed.configureTestingModule({
    imports: [OpdServiceEditorPage],
    providers: [
      { provide: OpdAdminApi, useValue: api }, { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id }), queryParamMap: convertToParamMap(q) } } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
    ],
  });
  TestBed.overrideComponent(OpdServiceEditorPage, { set: { imports: [NgTemplateOutlet, BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  const f = TestBed.createComponent(OpdServiceEditorPage);
  f.detectChanges();
  return { c: f.componentInstance, api, router };
}

describe('OPD service editor', () => {
  it('a new service takes the next code of its department and follows the category', () => {
    const { c } = render('new', { departmentId: 'ent' });
    expect(c.isNew()).toBe(true);
    expect(c.d().code).toBe('ENT-C02');
    c.patch({ category: 'procedure' });
    expect(c.d().code).toBe('ENT-P01');
  });

  it('per-doctor rows: every doctor listed; only a doctor with a fee and switched on is offered', () => {
    const { c } = render('s1');
    expect(c.docRows().map((r) => [r.doctorUserId, r.price, r.offered])).toEqual([['d1', 600, true], ['d2', null, false]]);
    expect(c.preview().map((p) => p.who)).toEqual(['Dr Rao']);
    expect(c.preview()[0].fu).toBe('Follow-up within 7 days: ₹300');
  });

  it('saves the service, then the per-doctor fee rows', async () => {
    const { c, api } = render('s1');
    c.setDoc(1, { price: 800, offered: true });
    await c.save();
    expect(api.saveServices).toHaveBeenCalled();
    expect(api.saveDoctorPrices).toHaveBeenCalledWith('s1', [
      { doctorUserId: 'd1', price: 600, followUpFee: 300, isActive: true },
      { doctorUserId: 'd2', price: 800, followUpFee: null, isActive: true },
    ]);
  });

  it('a common price never writes doctor rows', async () => {
    const { c, api } = render('s1');
    c.patch({ priceMode: 'common', commonPrice: 500 });
    expect(c.preview()).toEqual([{ who: 'Every doctor', meta: 'Common price', price: '₹500', fu: 'Follow-up within 7 days: ₹250' }]);
    await c.save();
    expect(api.saveDoctorPrices).not.toHaveBeenCalled();
  });

  it('the Form tab shows the questions of the form the doctor will fill', () => {
    const { c } = render('s1');
    expect(c.effectiveFormId()).toBe('f1');
    expect(c.formQuestions().map((q) => q.label)).toEqual(['Chief complaints']);
  });
});
