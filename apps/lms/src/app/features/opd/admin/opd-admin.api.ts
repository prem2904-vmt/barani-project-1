import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, shareReplay } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { OPD_API } from '../shared/opd-api';
import type { OpdPriceMode, OpdServiceCategory } from '../shared/opd.models';
import type { OpdFormDoc, OpdQuestion } from './forms/form-schema';

/**
 * OPD Master API (Agent A) — every call to /api/opd/admin goes through the
 * app's ApiService (no second HTTP client). Mirrors
 * prefrontal-mw Services/Opd/Admin/OpdAdminService.cs DTOs. The server omits
 * null properties, so optional fields may be absent.
 */
export interface OpdDepartmentRow {
  id: string; name: string; code: string; description?: string | null; defaultFormId?: string | null;
  sortOrder: number; isActive: boolean; serviceCount?: number;
}
export interface OpdDoctorPriceRow { doctorUserId: string; price: number; followUpFee?: number | null; isActive: boolean; }
export interface OpdServiceRow {
  id: string; departmentId: string; name: string; code: string; category: OpdServiceCategory; priceMode: OpdPriceMode;
  commonPrice: number; taxSlab: number; hsnSacCode?: string | null; followUpWithinDays?: number | null; followUpFee?: number | null;
  formId?: string | null; durationMinutes?: number | null; sortOrder: number; isActive: boolean; doctorPrices: OpdDoctorPriceRow[];
}
export type OpdServiceInput = Omit<OpdServiceRow, 'id' | 'doctorPrices'> & { id?: string | null };
export type OpdDepartmentInput = Omit<OpdDepartmentRow, 'id' | 'serviceCount'> & { id?: string | null };

export interface OpdDoctorAdminRow {
  userId: string; name: string; department?: string | null; specializations: string[]; regNo?: string | null; fee: number;
  room?: string | null; tokenPrefix?: string | null; days: string[];
  prices: { serviceId: string; price: number; followUpFee?: number | null; isActive: boolean }[];
}
export interface OpdDoctorInput {
  userId: string; room?: string | null; tokenPrefix?: string | null; days?: string[];
  prices?: { serviceId: string; price: number; followUpFee?: number | null; isActive: boolean }[];
}

export interface OpdFormListRow {
  id: string; name: string; code: string; description?: string | null; isActive: boolean;
  publishedVersion?: number | null; currentVersionId?: string | null; draftVersion?: number | null;
  questionCount: number; usedByServices: number; usedByDepartments: number; updatedAt: string;
}
export interface OpdFormVersionRow { id: string; formId: string; version: number; status: 'draft' | 'published'; schema: OpdFormDoc; createdAt: string; publishedAt?: string | null; }
export interface OpdFormDetail {
  id: string; name: string; code: string; description?: string | null; isActive: boolean; currentVersionId?: string | null;
  published?: OpdFormVersionRow | null; draft?: OpdFormVersionRow | null;
  versions: { id: string; version: number; status: string; createdAt: string; publishedAt?: string | null }[];
  usedBy: { kind: 'department' | 'service'; id: string; name: string; code: string }[];
}
export interface OpdStarter { key: string; name: string; formName: string; icon: string; schema: OpdFormDoc; }
export interface OpdResolvedForm { formId?: string | null; formName?: string | null; source: 'service' | 'department' | 'none'; version?: OpdFormVersionRow | null; addons: OpdQuestion[]; }

export interface OpdFeeQuote {
  offered: boolean; basePrice: number; isFollowUp: boolean; followUpWithinDays?: number | null; indexVisitDate?: string | null;
  followUpOfVisitId?: string | null; daysSinceIndexVisit?: number | null;
  rule: 'new' | 'service_follow_up' | 'tenant_tier' | 'assisted_ceiling' | 'not_offered';
  quoted: number; final: number; overridden: boolean; maxDiscountPercent?: number | null;
}

/** opd_settings JSON as the Workflow screen edits it (contract + additive keys). */
export interface OpdWorkflowSettings {
  workflow: {
    vitals: 'desk' | 'station' | 'off'; vitalsBy: 'nurse' | 'front_desk'; labTestsAtDesk: boolean;
    billing: 'before_consult' | 'after_consult'; prefill: { purposeToComplaint: boolean; vitalsToHeader: boolean };
    pharmacy: { enabled: boolean }; privateNotes: 'doctor' | 'department' | 'all_doctors';
  };
  queue: { organise: 'per_doctor' | 'per_room' | 'per_department'; tokenPrefix?: string | null; doctorUnavailable: 'manual' | 'auto_move' | 'reschedule'; showOnScreen: boolean };
  pharmacy: { batchPick: 'earliest_expiry' | 'pharmacist' };
}
export type OpdWorkflowPatch = { workflow?: Partial<OpdWorkflowSettings['workflow']>; queue?: Partial<OpdWorkflowSettings['queue']>; pharmacy?: Partial<OpdWorkflowSettings['pharmacy']> };

export interface OpdDoctorLite { id: string; name: string; department?: string | null; specializations: string[]; regNo?: string | null; fee: number; }

@Injectable({ providedIn: 'root' })
export class OpdAdminApi {
  private readonly api = inject(ApiService);
  private readonly base = OPD_API.admin;

  starter(): Observable<{ seeded: boolean }> { return this.api.post(`${this.base}/starter`, {}); }
  private starter$?: Observable<{ seeded: boolean }>;
  /** The lazy per-tenant starter set, asked once per session (the server runs
   *  it once per tenant anyway). A failure never blocks the page. */
  ensureStarter(): Observable<{ seeded: boolean }> {
    return (this.starter$ ??= this.starter().pipe(
      catchError(() => { this.starter$ = undefined; return of({ seeded: false }); }),
      shareReplay(1),
    ));
  }

  departments(): Observable<OpdDepartmentRow[]> { return this.api.get(`${this.base}/departments`); }
  saveDepartments(rows: OpdDepartmentInput[]): Observable<OpdDepartmentRow[]> { return this.api.put(`${this.base}/departments`, rows); }

  services(departmentId?: string): Observable<OpdServiceRow[]> {
    return this.api.get(`${this.base}/services${departmentId ? '?departmentId=' + encodeURIComponent(departmentId) : ''}`);
  }
  service(id: string): Observable<OpdServiceRow> { return this.api.get(`${this.base}/services/${id}`); }
  saveServices(rows: OpdServiceInput[]): Observable<OpdServiceRow[]> { return this.api.put(`${this.base}/services`, rows); }
  saveDoctorPrices(serviceId: string, rows: OpdDoctorPriceRow[]): Observable<OpdServiceRow> {
    return this.api.put(`${this.base}/services/${serviceId}/doctor-prices`, rows);
  }
  quote(serviceId: string, doctorUserId: string, patientId?: string | null, override?: number | null): Observable<OpdFeeQuote> {
    const q = new URLSearchParams({ serviceId, doctorUserId });
    if (patientId) q.set('patientId', patientId);
    if (override != null) q.set('override', String(override));
    return this.api.get(`${this.base}/quote?${q.toString()}`);
  }

  doctors(): Observable<OpdDoctorAdminRow[]> { return this.api.get(`${this.base}/doctors`); }
  saveDoctors(rows: OpdDoctorInput[]): Observable<OpdDoctorAdminRow[]> { return this.api.put(`${this.base}/doctors`, rows); }
  /** The existing doctor list (DoctorProfile users) — fee + reg. no. */
  doctorList(): Observable<OpdDoctorLite[]> { return this.api.get(OPD_API.doctors); }

  forms(): Observable<OpdFormListRow[]> { return this.api.get(`${this.base}/forms`); }
  starters(): Observable<OpdStarter[]> { return this.api.get(`${this.base}/forms/starters`); }
  createForm(body: { name?: string; starterKey?: string; copyFromFormId?: string; schema?: OpdFormDoc }): Observable<OpdFormDetail> {
    return this.api.post(`${this.base}/forms`, body);
  }
  form(id: string): Observable<OpdFormDetail> { return this.api.get(`${this.base}/forms/${id}`); }
  updateForm(id: string, body: { name?: string; description?: string; isActive?: boolean }): Observable<OpdFormDetail> {
    return this.api.put(`${this.base}/forms/${id}`, body);
  }
  saveDraft(id: string, schema: OpdFormDoc): Observable<OpdFormDetail> { return this.api.put(`${this.base}/forms/${id}/draft`, { schema }); }
  discardDraft(id: string): Observable<OpdFormDetail> { return this.api.delete(`${this.base}/forms/${id}/draft`); }
  publish(id: string): Observable<OpdFormDetail> { return this.api.post(`${this.base}/forms/${id}/publish`, {}); }
  version(versionId: string): Observable<OpdFormVersionRow> { return this.api.get(`${this.base}/forms/versions/${versionId}`); }
  resolve(q: { serviceId?: string; departmentId?: string; doctorUserId?: string }): Observable<OpdResolvedForm> {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v && p.set(k, v));
    return this.api.get(`${this.base}/forms/resolve?${p.toString()}`);
  }
  addons(formId: string, doctorUserId: string): Observable<{ formId: string; doctorUserId: string; fields: OpdQuestion[] }> {
    return this.api.get(`${this.base}/forms/${formId}/addons/${doctorUserId}`);
  }
  saveAddons(formId: string, doctorUserId: string, fields: OpdQuestion[]): Observable<{ formId: string; doctorUserId: string; fields: OpdQuestion[] }> {
    return this.api.put(`${this.base}/forms/${formId}/addons/${doctorUserId}`, { fields });
  }

  workflow(): Observable<OpdWorkflowSettings> { return this.api.get(`${this.base}/workflow`); }
  saveWorkflow(patch: OpdWorkflowPatch): Observable<OpdWorkflowSettings> { return this.api.put(`${this.base}/workflow`, patch); }
}
