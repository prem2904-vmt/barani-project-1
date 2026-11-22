import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { OpdAdminApi, OpdServiceRow } from './opd-admin.api';
import { DoctorsAdminComponent } from './doctors-admin.component';

/**
 * OPD Doctors grid — the existing DoctorProfile list extended with room,
 * token prefix, days and one fee column per PER-DOCTOR service. A blank fee
 * = not offered (no fallback price); reg. no. / fee still go through the
 * existing PATCH /api/doctors (only when they changed).
 */
const svc = (id: string, priceMode: 'common' | 'per_doctor'): OpdServiceRow => ({
  id, departmentId: 'ent', name: id, code: id, category: 'consultation', priceMode, commonPrice: 0, taxSlab: 0, sortOrder: 1, isActive: true, doctorPrices: [],
});

function render() {
  const api = {
    get: vi.fn(() => of([{ id: 'd1', name: 'Dr Rao', department: 'ENT', specializations: [], regNo: 'TN-1', fee: 500 }])),
    patch: vi.fn(() => of({})),
  };
  const admin = {
    doctors: vi.fn(() => of([{ userId: 'd1', name: 'Dr Rao', specializations: [], fee: 500, room: 'Room 3', tokenPrefix: 'A', days: ['mon'],
      prices: [{ serviceId: 's-per', price: 600, followUpFee: 300, isActive: true }] }])),
    services: vi.fn(() => of([svc('s-per', 'per_doctor'), svc('s-common', 'common')])),
    saveDoctors: vi.fn((rows: unknown[]) => of((rows as { userId: string }[]).map((r) => ({ ...r, name: 'Dr Rao', specializations: [], fee: 500, prices: [] })))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    imports: [DoctorsAdminComponent],
    providers: [
      { provide: ApiService, useValue: api }, { provide: OpdAdminApi, useValue: admin }, { provide: ToastService, useValue: toasts },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
    ],
  });
  TestBed.overrideComponent(DoctorsAdminComponent, { set: { imports: [BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  const f = TestBed.createComponent(DoctorsAdminComponent);
  f.detectChanges();
  return { c: f.componentInstance, api, admin, toasts };
}

describe('OPD Doctors grid', () => {
  it('merges the doctor list with room / prefix / days and per-service fees', () => {
    const { c } = render();
    const r = c.rowData()[0];
    expect(r).toMatchObject({ id: 'd1', regNo: 'TN-1', room: 'Room 3', tokenPrefix: 'A', days: ['mon'] });
    expect(r['fee:s-per']).toBe(600);
  });

  it('shows a fee column only for per-doctor services', () => {
    const { c } = render();
    const ids = c.colDefs().map((d) => d.colId ?? d.field);
    expect(ids).toContain('fee:s-per');
    expect(ids).not.toContain('fee:s-common');
  });

  it('every data column sorts and filters on its real value; none is exempt (no action column)', () => {
    const { c } = render();
    for (const d of c.colDefs()) {
      const id = String(d.colId ?? d.field);
      expect(sortsAndFilters(d as never), id).toBe(true);
    }
  });

  it('clearing a fee sends the row as not offered; reg. no. unchanged ⇒ no PATCH', () => {
    const { c, admin, api } = render();
    const r = c.rowData()[0];
    r['fee:s-per'] = null;
    r.room = 'Room 5';
    c.onCellValueChanged({ data: r } as never);
    c.save();
    expect(admin.saveDoctors).toHaveBeenCalledWith([expect.objectContaining({
      userId: 'd1', room: 'Room 5', prices: [{ serviceId: 's-per', price: 600, followUpFee: 300, isActive: false }],
    })]);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('a changed registration number still goes to PATCH /api/doctors (the one home)', () => {
    const { c, api } = render();
    const r = c.rowData()[0];
    r.regNo = 'TN-2';
    c.onCellValueChanged({ data: r } as never);
    c.save();
    expect(api.patch).toHaveBeenCalledWith('/api/doctors/d1', { fee: 500, regNo: 'TN-2' });
  });
});
