import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { OPD_API } from '../shared/opd-api';
import type {
  DrugForm, DrugSchedule, OpdDiagnosis, OpdFormDoc, OpdNoteVisibility, OpdPatientAllergy,
  OpdRxLineDto, OpdVisitStatus, OpdVitals,
} from '../shared/opd.models';
import type { RxSchedule } from '../shared/rx-schedule';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { OpdMediaRef } from '../admin/forms/renderer';

/**
 * Agent C — the consult API (prefrontal-mw Controllers/Opd/OpdConsultController).
 * Wire shapes only; every call goes through the app's ApiService and every
 * endpoint answers 404 unless the caller is OPD-allowed.
 */
export const CONSULT_API = OPD_API.consult;

export interface ConsultQueueRow {
  visitId: string; patientId: string; patientName: string; ageSex?: string | null; mrn?: string | null;
  token: number; status: OpdVisitStatus; purpose?: string | null; departmentName?: string | null; serviceName?: string | null;
  isFollowUp: boolean; checkedInAt?: string | null; consultStartedAt?: string | null; completedAt?: string | null;
  hasVitals: boolean; allergyCount: number; doctorUserId: string; doctorName?: string | null;
}

export interface ConsultVitals extends OpdVitals { recordedByName?: string | null; visitDate?: string | null; }

export interface ConsultFormRef {
  formId: string; formName: string; versionId: string; version: number;
  /** Schema v2 (Agent A's OpdFormDoc; a v1 schema is normalised by the renderer). */
  schema: OpdFormDoc | unknown;
  /** The doctor's add-only questions → the renderer's `addons`. */
  addonFields: unknown[];
}

export interface ConsultRecordDto {
  id: string; formVersionId?: string | null; answers?: Record<string, unknown> | null;
  chiefComplaint?: string | null; diagnoses: OpdDiagnosis[]; advice?: string | null;
  privateNotes?: string | null; privateNotesVisibility: OpdNoteVisibility; privateNotesHidden: boolean;
  followUpDate?: string | null; followUpNote?: string | null; status: 'draft' | 'completed';
  startedAt?: string | null; completedAt?: string | null; updatedAt?: string | null;
}

export interface ConsultInvestigationItem { testId: string; name: string; price?: number | null; }
export interface ConsultInvestigation { id?: string; items: ConsultInvestigationItem[]; labOrderId?: string | null; status: 'draft' | 'ordered' | 'cancelled'; }

export interface ConsultCurrentMedicine {
  drugName: string; form: DrugForm; dose: number; schedule: RxSchedule; durationDays: number; food?: 'Before' | 'After' | null;
  prescribedOn: string; doctorName?: string | null; endsOn?: string | null;
}

export interface ConsultWorkspace {
  visit: {
    id: string; patientId: string; doctorUserId: string; doctorName?: string | null;
    departmentId?: string | null; departmentName?: string | null; serviceId?: string | null; serviceName?: string | null;
    visitNumber?: string | null; visitDate: string; token: number; status: OpdVisitStatus; purpose?: string | null;
    isFollowUp: boolean; source?: string | null; checkedInAt?: string | null; consultStartedAt?: string | null;
    completedAt?: string | null; labOrderId?: string | null; canEdit: boolean;
  };
  patient: { id: string; name: string; ageDisplay?: string | null; sex?: string | null; mrn?: string | null; phone?: string | null };
  vitals: ConsultVitals | null;
  vitalsHistory: ConsultVitals[];
  consult: ConsultRecordDto | null;
  rx: OpdRxLineDto[];
  investigations: ConsultInvestigation[];
  allergies: OpdPatientAllergy[];
  form: ConsultFormRef | null;
  followUpRule: { withinDays: number; fee?: number | null } | null;
  lastVisit: { visitId: string; visitDate: string; doctorName?: string | null; diagnoses: OpdDiagnosis[]; rx: OpdRxLineDto[] } | null;
  currentMedicines: ConsultCurrentMedicine[];
  conditions: { label: string; code?: string | null; since: string; doctorName?: string | null; count: number }[];
  pastVisits: { visitId: string; visitDate: string; doctorName?: string | null; departmentName?: string | null; diagnoses: OpdDiagnosis[] }[];
  noteVisibilityDefault: OpdNoteVisibility;
}

export interface ConsultDraftBody {
  answers?: Record<string, unknown>;
  chiefComplaint?: string | null;
  diagnoses: OpdDiagnosis[];
  advice?: string | null;
  privateNotes?: string | null;
  privateNotesVisibility?: OpdNoteVisibility;
  followUpDate?: string | null;
  followUpNote?: string | null;
  rx: OpdRxLineDto[];
  investigationItems: { testId: string; name: string }[];
}

export interface ConsultDrug {
  id: string; catalogKey: string; name: string; generic?: string | null; strength?: string | null;
  form: DrugForm; unit?: string | null; schedule: DrugSchedule | string; aliases?: string | null; isMaster: boolean;
  /** Integrator (pharmacy_drugs): topical site kind + the usual Rx for favourites. */
  siteKind?: string | null; usual?: Record<string, unknown> | null;
}

/** A stored consult file (POST /api/opd/consult/{visitId}/media). */
export interface ConsultStoredFile { id: string; name: string; kind: 'image' | 'video' | 'file'; contentType: string; size: number; url?: string | null; }

/** The renderer's media answer entry for a stored file. */
export function mediaRefOf(f: ConsultStoredFile): OpdMediaRef {
  return { id: f.id, name: f.name, kind: f.kind, url: f.url ?? undefined };
}

export interface ConsultDxSuggestion { code?: string | null; label: string; source: 'mine' | 'common'; }
export interface ConsultUsual { rx: OpdRxLineDto[]; tests: { testId: string; name: string }[]; fromVisitDate?: string | null; }
export interface ConsultPastConsult {
  visitId: string; visitDate: string; doctorName?: string | null; departmentName?: string | null;
  diagnoses: OpdDiagnosis[]; chiefComplaint?: string | null; advice?: string | null;
  form: ConsultFormRef | null; answers?: Record<string, unknown> | null;
  rx: OpdRxLineDto[]; investigations: ConsultInvestigation[];
}

/** A lab test as the order screen's catalogue lists it (/api/tests/?view=summary). */
export interface LabTestRow { id: string; name: string; testCode?: string | null; shortName?: string | null; price?: number | null; type?: string | null; isActive?: boolean; }

@Injectable({ providedIn: 'root' })
export class ConsultApi {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  myQueue(date?: string, doctorId?: string): Observable<ConsultQueueRow[]> {
    const q = new URLSearchParams();
    if (date) q.set('date', date);
    if (doctorId) q.set('doctorId', doctorId);
    const s = q.toString();
    return this.api.get<ConsultQueueRow[]>(`${CONSULT_API}/my-queue${s ? '?' + s : ''}`);
  }
  workspace(visitId: string): Observable<ConsultWorkspace> { return this.api.get<ConsultWorkspace>(`${CONSULT_API}/${visitId}`); }
  start(visitId: string): Observable<ConsultWorkspace> { return this.api.post<ConsultWorkspace>(`${CONSULT_API}/${visitId}/start`, {}); }
  saveDraft(visitId: string, body: ConsultDraftBody): Observable<ConsultWorkspace> { return this.api.put<ConsultWorkspace>(`${CONSULT_API}/${visitId}/draft`, body); }
  complete(visitId: string, body: ConsultDraftBody): Observable<ConsultWorkspace> { return this.api.post<ConsultWorkspace>(`${CONSULT_API}/${visitId}/complete`, body); }
  allergies(patientId: string): Observable<OpdPatientAllergy[]> { return this.api.get<OpdPatientAllergy[]>(`${CONSULT_API}/patients/${patientId}/allergies`); }
  addAllergy(patientId: string, a: Partial<OpdPatientAllergy>): Observable<OpdPatientAllergy> { return this.api.post<OpdPatientAllergy>(`${CONSULT_API}/patients/${patientId}/allergies`, a); }
  removeAllergy(id: string): Observable<OpdPatientAllergy> { return this.api.delete<OpdPatientAllergy>(`${CONSULT_API}/allergies/${id}`); }
  diagnoses(q: string): Observable<ConsultDxSuggestion[]> { return this.api.get<ConsultDxSuggestion[]>(`${CONSULT_API}/diagnoses?q=${encodeURIComponent(q)}`); }
  usual(dx: string): Observable<ConsultUsual | null> { return this.api.get<ConsultUsual | null>(`${CONSULT_API}/usual?dx=${encodeURIComponent(dx)}`); }
  drugs(q = ''): Observable<ConsultDrug[]> { return this.api.get<ConsultDrug[]>(`${CONSULT_API}/drugs${q ? '?q=' + encodeURIComponent(q) : ''}`); }
  /** Upload one file for a media question (any format). File uploads post
   *  FormData through HttpClient (the app's convention — ApiService is JSON). */
  uploadMedia(visitId: string, file: File): Observable<ConsultStoredFile> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<{ success: boolean; data?: ConsultStoredFile; message?: string; error?: string }>(
      `${environment.apiUrl}${CONSULT_API}/${visitId}/media`, fd).pipe(map(r => {
        if (!r?.success || !r.data) throw new Error(r?.message || r?.error || 'Upload failed');
        return r.data;
      }));
  }
  /** A fresh signed URL for a stored consult file. */
  mediaUrl(visitId: string, key: string): Observable<string> {
    return this.api.get<string>(`${CONSULT_API}/${visitId}/media?key=${encodeURIComponent(key)}`);
  }
  history(patientId: string): Observable<ConsultPastConsult[]> { return this.api.get<ConsultPastConsult[]>(`${CONSULT_API}/patients/${patientId}/history`); }
  /** The lab catalogue the order screen uses (reuse, no second test search). */
  labTests(): Observable<LabTestRow[]> { return this.api.get<LabTestRow[]>('/api/tests/?activeOnly=true&view=summary'); }
  /** The patient's lab trends (the timeline's own source) — recent results. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  labTrends(patientId: string): Observable<any> { return this.api.get<any>(`/api/patients/${patientId}/lab-trends`); }
}
