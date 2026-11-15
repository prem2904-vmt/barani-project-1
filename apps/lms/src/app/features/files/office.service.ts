import { HttpClient, HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, plainStatusMessage } from '../../shared/models/api-response.model';
import { PlatformService } from '../../core/services/platform.service';
import { XLSX_MIME, isArrayBuffer } from './files-bridge';
import { ResultsRange, fileNameFromDisposition, resultsWorkbookPath } from '../neuron/results-query';

/** One stored file (`/api/office/files`). */
export interface PhiSource { source: string; at: string; by?: string | null; byName?: string | null; detail?: string | null }
export interface OfficeFile {
  id: string; name: string; kind: string; sizeBytes: number; version: number | string; updatedAt: string; updatedByName: string | null;
  /** Set when the trash lists it. */
  deletedAt?: string | null;
  /** Prefrontal put patient data into this file (sticky; kept out of outside AI). */
  containsPhi?: boolean;
  phiSources?: PhiSource[] | null;
  /** "view" | "edit" when the file is shared WITH me (not mine, not lab-wide). */
  sharedAccess?: 'view' | 'edit' | null;
  ownerId?: string | null;
}
export interface OfficeShare { id: string; principalType: 'user' | 'role'; principalId: string; name: string; detail?: string | null; access: 'view' | 'edit' }
export interface OfficeShareList { ownerId?: string | null; ownerName?: string | null; isOwner: boolean; canManage: boolean; shares: OfficeShare[] }
export interface OfficeShareTarget { type: 'user' | 'role'; id: string; name: string; detail?: string | null }
/** Per-app access of the signed-in person (GET /api/office/settings → access). */
export interface OfficeAppAccess { enabled: boolean; canRead: boolean; canWrite: boolean }
export interface OfficeAccess { apps: Record<string, OfficeAppAccess>; editOnPhones: boolean; trashDays: number; patientNames: boolean; canManage: boolean; full: boolean }
export interface OfficeAppSetting { enabled: boolean; editRoles: string[] }
export interface OfficeOwnTemplate { id: string; kind: string; name: string; fileId: string }
export interface OfficeSettings {
  apps: Record<string, OfficeAppSetting>; editOnPhones: boolean; trashDays: number; patientNames: boolean;
  ownTemplates: OfficeOwnTemplate[]; hiddenTemplates: string[];
}
export interface OfficeSettingsResponse { settings: OfficeSettings; access: OfficeAccess }
export interface OfficeStorage { totalBytes: number; byKind: { kind: string; count: number; bytes: number }[]; trashCount: number; trashBytes: number }
export interface OfficeContent { bytes: ArrayBuffer; version: string }
export interface ResultsWorkbook { bytes: ArrayBuffer; truncated: boolean; fileName: string | null; rowCount: number | null }

/** Someone else saved first (HTTP 409 on a PUT). Never overwritten silently. */
export class OfficeConflictError extends Error {
  constructor() { super('Someone else saved this file while you were working.'); this.name = 'OfficeConflictError'; }
}

/** `"7"`, `W/"7"` or `7` → `7`. */
export function parseEtag(h: string | null | undefined): string {
  return (h ?? '').trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}
/** The If-Match value for a stored version. */
export const ifMatch = (version: number | string): string => `"${String(version).replace(/"/g, '')}"`;

/** Unwrap the `{ success, data }` envelope when the server uses it, else take the body as it is. */
function unwrap<T>(body: unknown): T {
  const rec = body as { success?: unknown; data?: unknown } | null;
  if (rec && typeof rec === 'object' && !Array.isArray(rec) && 'success' in rec) {
    if (rec.success === false) { const r = body as { message?: string; error?: string }; throw new ApiError(r.message ?? r.error ?? 'Request failed', r.error); }
    if ('data' in rec) return rec.data as T;
  }
  return body as T;
}

/** An error whose body arrived as bytes (blob / arraybuffer calls): read the server's words out of it. */
function decodeBodyMessage(e: HttpErrorResponse): { message?: string; code?: string } | null {
  const b = e.error;
  try {
    const text = isArrayBuffer(b) ? new TextDecoder().decode(b) : typeof b === 'string' ? b : null;
    if (!text) return null;
    const j = JSON.parse(text) as { message?: string; error?: string };
    return { message: j.message, code: j.error };
  } catch { return null; }
}

/** Plain words for the server's codes (`/api/office`): the raw code or the server's English never reaches the screen. */
export const OFFICE_MESSAGES: Record<string, string> = {
  bad_file: "That file couldn't be opened here.",
  module_readonly: 'Files are view only for your organization.',
  app_off: 'This app is turned off for your lab.',
  forbidden: "Your role can't do that here.",
  share_exceeds_rights: "You can only share for viewing: you can't edit this file yourself.",
  bad_access: 'Choose Can view or Can edit.',
  bad_principal: "That person or role isn't in your lab.",
  owner: 'That person already owns this file.',
  phi_export_denied: "This file contains patient data, and your role can't save it to this device.",
  bad_phi_source: "That patient-data source isn't known.",
  bad_kind: "That kind of file isn't supported here.",
  bad_name: 'That file name is not allowed. Use letters, numbers and spaces.',
  if_match_required: 'This sheet has to be reloaded before it can be saved. Reload it and try again.',
  bad_test_ids: 'Pick at least one test from the list.',
  bad_range: 'Pick a valid first and last date.',
  range_too_long: 'That date range is too long. Pick a shorter one.',
  bad_branch: "That branch isn't available to you.",
  not_found: "That file isn't there any more. It may have been deleted.",
  file_missing: "This file's contents are missing. Ask your admin to check the file storage.",
  storage_error: 'The file store had a problem. Try again in a moment.',
  storage_unconfigured: "File storage isn't set up yet. Ask your admin.",
};

export function toApiError(e: unknown): ApiError {
  const err = toApiErrorRaw(e);
  let plain = err.code ? OFFICE_MESSAGES[err.code] : undefined;
  // A bare code with no words of its own ("server_error") never reaches the screen: say it by HTTP status.
  if (!plain && err.code && err.message === err.code) plain = plainStatusMessage(err.status, true) ?? 'Something went wrong. Try again in a moment.';
  return plain ? new ApiError(plain, err.code, err.field, err.data, err.status) : err;
}

function toApiErrorRaw(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof HttpErrorResponse && (isArrayBuffer(e.error) || typeof e.error === 'string')) {
    const m = decodeBodyMessage(e);
    if (m?.message || m?.code) return new ApiError(m.message ?? m.code ?? 'Request failed', m.code, undefined, undefined, e.status);
    return ApiError.from(new HttpErrorResponse({ status: e.status, statusText: e.statusText, url: e.url ?? undefined }));
  }
  return ApiError.from(e);
}

/**
 * Neuron's stored files (prefrontal-mw `/api/office`). The browser's beta header rides on the shared interceptor.
 * JSON calls accept either the `{ success, data }` envelope or a bare body; binary calls are raw.
 */
@Injectable({ providedIn: 'root' })
export class OfficeService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(PlatformService).getApiUrl();

  private async call<T>(p: Promise<T>): Promise<T> {
    try { return await p; } catch (e) { throw toApiError(e); }
  }

  /** The files of one kind (omit for every kind this person may read); `trash` = the deleted ones still inside the Trash window. */
  list(kind?: string, trash = false, shared = false): Promise<OfficeFile[]> {
    const q = [kind ? `kind=${encodeURIComponent(kind)}` : '', trash ? 'trash=true' : '', shared ? 'shared=true' : ''].filter(Boolean).join('&');
    return this.call(firstValueFrom(this.http.get<unknown>(`${this.base}/api/office/files${q ? `?${q}` : ''}`))
      .then(b => unwrap<OfficeFile[]>(b) ?? []));
  }

  private form(name: string, bytes: ArrayBuffer, kind?: string, extra: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: 'application/octet-stream' }), name);
    fd.append('name', name);
    if (kind) fd.append('kind', kind);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
  }

  /** `phiSource` = Prefrontal filled this file with patient data (results, patient, report, partner_report, image); `copyOf` = a copy of a stored file (inherits its patient-data flag on the server). */
  create(name: string, bytes: ArrayBuffer, kind = 'sheet', opts: { phiSource?: string; copyOf?: string } = {}): Promise<OfficeFile> {
    const extra: Record<string, string> = {};
    if (opts.phiSource) extra['phiSource'] = opts.phiSource;
    if (opts.copyOf) extra['copyOf'] = opts.copyOf;
    return this.call(firstValueFrom(this.http.post<unknown>(`${this.base}/api/office/files`, this.form(name, bytes, kind, extra))).then(b => unwrap<OfficeFile>(b)));
  }

  content(id: string): Promise<OfficeContent> {
    return this.call(firstValueFrom(this.http.get(`${this.base}/api/office/files/${encodeURIComponent(id)}/content`, { responseType: 'arraybuffer', observe: 'response' }))
      .then((r: HttpResponse<ArrayBuffer>) => ({ bytes: r.body as ArrayBuffer, version: parseEtag(r.headers.get('ETag')) })));
  }

  /** Save over a stored file. 409 ⇒ {@link OfficeConflictError} (never retried, never forced). */
  async update(id: string, name: string, bytes: ArrayBuffer, version: number | string): Promise<OfficeFile> {
    try {
      const b = await firstValueFrom(this.http.put<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/content`, this.form(name, bytes),
        { headers: new HttpHeaders({ 'If-Match': ifMatch(version) }) }));
      return unwrap<OfficeFile>(b);
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 409) throw new OfficeConflictError();
      throw toApiError(e);
    }
  }

  rename(id: string, name: string): Promise<OfficeFile> {
    return this.call(firstValueFrom(this.http.patch<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}`, { name })).then(b => unwrap<OfficeFile>(b)));
  }

  remove(id: string): Promise<void> {
    return this.call(firstValueFrom(this.http.delete<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}`)).then(() => undefined));
  }

  restore(id: string): Promise<OfficeFile> {
    return this.call(firstValueFrom(this.http.post<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/restore`, {})).then(b => unwrap<OfficeFile>(b)));
  }

  /** Flag a stored file as holding patient data (sticky; the server has no un-flag). */
  markPhi(id: string, source: string, detail?: string): Promise<OfficeFile> {
    return this.call(firstValueFrom(this.http.post<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/phi`, { source, detail })).then(b => unwrap<OfficeFile>(b)));
  }

  copy(id: string, name?: string): Promise<OfficeFile> {
    return this.call(firstValueFrom(this.http.post<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/copy`, { name })).then(b => unwrap<OfficeFile>(b)));
  }

  /** Asked BEFORE a lab file's bytes are written to this device: the server decides (flagged files need export_patient_data) and audits. Rejects with the server's plain words. */
  deviceExport(id: string, client: 'web' | 'electron' | 'ios' | 'android'): Promise<void> {
    return this.call(firstValueFrom(this.http.post<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/device-export`, { client })).then(() => undefined));
  }

  // ── Share (people or roles of the same lab; no public links) ──
  shares(id: string): Promise<OfficeShareList> {
    return this.call(firstValueFrom(this.http.get<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/shares`)).then(b => unwrap<OfficeShareList>(b)));
  }
  shareTargets(q = ''): Promise<OfficeShareTarget[]> {
    return this.call(firstValueFrom(this.http.get<unknown>(`${this.base}/api/office/share-targets?q=${encodeURIComponent(q)}`)).then(b => unwrap<OfficeShareTarget[]>(b) ?? []));
  }
  addShare(id: string, type: 'user' | 'role', principalId: string, access: 'view' | 'edit'): Promise<OfficeShare> {
    return this.call(firstValueFrom(this.http.put<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/shares`, { type, principalId, access })).then(b => unwrap<OfficeShare>(b)));
  }
  removeShare(id: string, shareId: string): Promise<void> {
    return this.call(firstValueFrom(this.http.delete<unknown>(`${this.base}/api/office/files/${encodeURIComponent(id)}/shares/${encodeURIComponent(shareId)}`)).then(() => undefined));
  }

  settings(): Promise<OfficeSettingsResponse> {
    return this.call(firstValueFrom(this.http.get<unknown>(`${this.base}/api/office/settings`)).then(b => unwrap<OfficeSettingsResponse>(b)));
  }
  saveSettings(s: Partial<OfficeSettings>): Promise<OfficeSettingsResponse> {
    return this.call(firstValueFrom(this.http.put<unknown>(`${this.base}/api/office/settings`, s)).then(b => unwrap<OfficeSettingsResponse>(b)));
  }
  storage(): Promise<OfficeStorage> {
    return this.call(firstValueFrom(this.http.get<unknown>(`${this.base}/api/office/storage`)).then(b => unwrap<OfficeStorage>(b)));
  }

  /** The results as an .xlsx (the server may cut it at 5,000 rows and says so in `X-Truncated`). */
  resultsWorkbook(r: ResultsRange): Promise<ResultsWorkbook> {
    return this.call(firstValueFrom(this.http.get(`${this.base}${resultsWorkbookPath(r)}`, { responseType: 'arraybuffer', observe: 'response' }))
      .then((res: HttpResponse<ArrayBuffer>) => ({
        bytes: res.body as ArrayBuffer,
        truncated: (res.headers.get('X-Truncated') ?? '').toLowerCase() === 'true',
        fileName: fileNameFromDisposition(res.headers.get('Content-Disposition')),
        rowCount: /^\d+$/.test(res.headers.get('X-Row-Count') ?? '') ? Number(res.headers.get('X-Row-Count')) : null,
      })));
  }
}
