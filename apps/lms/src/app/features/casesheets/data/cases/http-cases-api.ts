import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Answers, FormDefinition } from '@prefrontal/forms-engine';
// light entry: this service is provided at the root, so it must not pull the whole engine into the first download
import { toNarrativeTables } from '@prefrontal/forms-engine/providers';
import { firstValueFrom } from 'rxjs';
import { api } from '../api-url';
import {
  CaseConflict,
  CaseLink,
  CaseSheetDepartment,
  CaseFinal,
  CaseNarrative,
  CaseSave,
  CaseSheet,
  CaseState,
  CaseSummary,
  FinishRefused,
  FormSummary,
  MissingAnswer,
  NarrativeSection,
  Page,
  PatientBlock,
  PdfLink,
  PracticeImage,
  PracticeSettings,
  PublishedForm,
  SaveAck,
  Suggestion,
  VoiceUnavailable,
} from './case-models';
import { CasesApi } from './cases-api';

/* ---------------- wire shapes (prefrontal-mw /api/casesheets/*, Prepare's contract; docs/CASESHEETS.md) ---------------- */

type Json = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function toPatient(v: unknown): PatientBlock {
  const p = obj(v);
  return { name: strOrNull(p['name']), age: strOrNull(p['age']), sex: strOrNull(p['sex']), ref: strOrNull(p['ref']) };
}

/** `CaseSheetViews.Full` → CaseSheet. */
export function toCaseSheet(v: unknown): CaseSheet {
  const c = obj(v);
  return {
    id: str(c['id']),
    state: c['state'] === 'final' ? 'final' : 'draft',
    formId: str(c['formId']),
    formTitle: str(c['formTitle']),
    formVersionId: str(c['formVersionId']),
    formVersionNo: num(c['formVersionNo']),
    patientId: strOrNull(c['patientId']),
    patient: toPatient(c['patient']),
    answers: obj(c['answers']),
    visitedPages: arr(c['visitedPages']).filter((x): x is string => typeof x === 'string'),
    rowVersion: num(c['rowVersion']),
    createdAt: str(c['createdAt']),
    updatedAt: str(c['updatedAt']),
    finalisedAt: strOrNull(c['finalisedAt']),
    amendedFromId: strOrNull(c['amendedFromId']),
    hasPdf: c['hasPdf'] === true,
    source: str(c['source']) || 'human',
  };
}

/** `CaseSheetViews.Item` → CaseSummary. */
export function toCaseSummary(v: unknown): CaseSummary {
  const c = obj(v);
  return {
    id: str(c['id']),
    state: c['state'] === 'final' ? 'final' : 'draft',
    formId: str(c['formId']),
    formTitle: str(c['formTitle']),
    formVersionId: str(c['formVersionId']),
    patientId: strOrNull(c['patientId']),
    patientName: strOrNull(c['patientName']),
    patientAge: strOrNull(c['patientAge']),
    patientSex: strOrNull(c['patientSex']),
    lastPage: strOrNull(c['lastPage']),
    updatedAt: str(c['updatedAt']),
    finalisedAt: strOrNull(c['finalisedAt']),
    hasPdf: c['hasPdf'] === true,
    rowVersion: num(c['rowVersion']),
    amendedFromId: strOrNull(c['amendedFromId']),
    source: str(c['source']) || 'human',
  };
}

export function toAck(v: unknown): SaveAck {
  const a = obj(v);
  return {
    id: str(a['id']),
    state: a['state'] === 'final' ? 'final' : 'draft',
    rowVersion: num(a['rowVersion']),
    updatedAt: str(a['updatedAt']),
  };
}

function toSection(v: unknown): NarrativeSection {
  const s = obj(v);
  const key = str(s['key']) || str(s['id']);
  const generated = typeof s['generated'] === 'string' ? (s['generated'] as string) : str(s['content']);
  const edited = typeof s['edited'] === 'string' ? (s['edited'] as string) : null;
  return {
    id: str(s['id']) || key || `order-${num(s['order'])}`,
    key,
    title: str(s['title']),
    order: num(s['order']),
    generated,
    edited,
    stale: s['stale'] === true,
    content: typeof s['content'] === 'string' ? (s['content'] as string) : (edited ?? generated),
    own: s['own'] === true,
    formTitle: strOrNull(s['formTitle']),
    tables: toNarrativeTables(s['tables']),
  };
}

/** `GET /narrative` (and, with defaults, `POST /api/casesheets/narrative/preview`) → CaseNarrative. */
export function toNarrative(v: unknown): CaseNarrative {
  const n = obj(v);
  return {
    state: n['state'] === 'final' ? 'final' : 'draft',
    rowVersion: num(n['rowVersion']),
    frozen: n['frozen'] === true,
    patientName: str(n['patientName']),
    age: strOrNull(n['age']),
    sex: strOrNull(n['sex']),
    sections: arr(n['sections'])
      .map(toSection)
      .sort((a, b) => a.order - b.order),
    tables: toNarrativeTables(n['tables']),
    warnings: arr(n['warnings']).filter((x): x is string => typeof x === 'string'),
  };
}

function toImage(v: unknown): PracticeImage | null {
  const i = obj(v);
  if (typeof i['url'] !== 'string') return null;
  return {
    url: absolute(i['url'] as string),
    width: typeof i['width'] === 'number' ? (i['width'] as number) : null,
    height: typeof i['height'] === 'number' ? (i['height'] as number) : null,
  };
}

export function toPractice(v: unknown): PracticeSettings {
  const p = obj(v);
  return {
    practiceName: str(p['practiceName']),
    doctorName: str(p['doctorName']),
    addressLine1: str(p['addressLine1']),
    addressLine2: str(p['addressLine2']),
    phone: str(p['phone']),
    email: str(p['email']),
    website: str(p['website']),
    enabled: p['enabled'] !== false,
    logo: toImage(p['logo']),
    signature: toImage(p['signature']),
  };
}

function toMissing(v: unknown): MissingAnswer {
  const m = obj(v);
  return { page: str(m['page']), pageTitle: str(m['pageTitle']), field: str(m['field']), label: str(m['label']) };
}

/** Problem+json `code` → the typed errors the screens understand; anything else is rethrown as is. */
export function mapError(e: unknown): unknown {
  if (!(e instanceof HttpErrorResponse)) return e;
  const body = obj(e.error);
  const code = str(body['code']);
  if (e.status === 409 && code === 'version_conflict')
    return new CaseConflict(body['current'] ? toCaseSheet(body['current']) : null);
  if (e.status === 409 && code === 'sheet_final') return new CaseFinal();
  if (e.status === 422 && code === 'incomplete') return new FinishRefused(arr(body['missing']).map(toMissing));
  if (e.status === 501 && code === 'voice_not_configured') return new VoiceUnavailable();
  return e;
}

const nul = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** Forms per page (the API's most) and the most pages read (10,000 forms). */
const FORM_PAGE = 100;
const FORM_PAGES_MAX = 100;

/** The real API (prefrontal-mw `/api/casesheets/*`). */
@Injectable()
export class HttpCasesApi extends CasesApi {
  private readonly http = inject(HttpClient);

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      throw mapError(e);
    }
  }

  private get<T = unknown>(path: string, params?: HttpParams): Promise<T> {
    return this.call(() => firstValueFrom(this.http.get<T>(api(path), { params })));
  }

  private send<T = unknown>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    params?: HttpParams,
  ): Promise<T> {
    return this.call(() => firstValueFrom(this.http.request<T>(method, api(path), { body, params })));
  }

  // ---------------- forms ----------------

  async listForms(): Promise<FormSummary[]> {
    // the API pages (100 at most per page): a practice can have more forms than one page holds
    const items: unknown[] = [];
    for (let page = 1; page <= FORM_PAGES_MAX; page++) {
      const r = obj(await this.get('/api/casesheets/forms', new HttpParams().set('page', page).set('pageSize', FORM_PAGE)));
      const got = arr(r['items']);
      items.push(...got);
      if (got.length < FORM_PAGE || items.length >= num(r['total'], 0)) break;
    }
    return items
      .map(obj)
      .filter((f) => f['published'])
      .map((f) => {
        const p = obj(f['published']);
        return {
          id: str(f['id']),
          key: str(f['key']),
          title: str(f['title']),
          // the master department's name when the API sends it (plan §3.3), else Prepare's free-text specialty
          specialty: strOrNull(f['departmentName']) ?? strOrNull(f['specialty']),
          departmentKey: strOrNull(f['departmentKey']),
          publishedVersionId: strOrNull(p['id']),
          versionNo: typeof p['versionNo'] === 'number' ? (p['versionNo'] as number) : null,
          publishedAt: strOrNull(p['publishedAt']),
          pinned: f['pinned'] === true,
        };
      });
  }

  async listDepartments(): Promise<CaseSheetDepartment[]> {
    const r = await this.get('/api/casesheets/departments');
    const items = Array.isArray(r) ? r : arr(obj(r)['items']);
    return items
      .map(obj)
      .filter((d) => d['isActive'] !== false && str(d['key']))
      .map((d) => ({ key: str(d['key']), name: str(d['name']) || str(d['key']), sortOrder: num(d['sortOrder']) }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async pinForm(formId: string, pinned: boolean): Promise<void> {
    await this.send(pinned ? 'PUT' : 'DELETE', `/api/casesheets/forms/${enc(formId)}/pin`, pinned ? {} : undefined);
  }

  async suggestions(formId: string, field: string, q?: string, limit = 5): Promise<Suggestion[]> {
    let params = new HttpParams().set('formId', formId).set('field', field).set('limit', limit);
    if (q?.trim()) params = params.set('q', q.trim());
    const r = obj(await this.get('/api/casesheets/suggestions', params));
    return arr(r['items'])
      .map(obj)
      .map((i) => ({ id: str(i['id']), text: str(i['text']), uses: num(i['uses']) }))
      .filter((i) => i.id && i.text);
  }

  async deleteSuggestion(id: string): Promise<void> {
    await this.send('DELETE', `/api/casesheets/suggestions/${enc(id)}`);
  }

  async publishedForm(formId: string): Promise<PublishedForm> {
    const r = obj(await this.get(`/api/casesheets/forms/${enc(formId)}/published`));
    return {
      formId: str(r['formId']) || formId,
      versionId: str(r['id']),
      versionNo: num(r['versionNo']),
      definition: r['definition'] as FormDefinition,
    };
  }

  async formVersion(formId: string, versionId: string): Promise<FormDefinition> {
    let live: PublishedForm | null = null;
    try {
      live = await this.publishedForm(formId);
      if (live.versionId === versionId) return live.definition;
    } catch {
      live = null;
    }
    try {
      const v = obj(await this.get(`/api/casesheets/forms/${enc(formId)}/versions/${enc(versionId)}`));
      const def = (v['definition'] ?? obj(v['version'])['definition']) as FormDefinition | undefined;
      if (def?.pages) return def;
    } catch (e) {
      // A doctor may not read an old version (403) — fall back to the live one below.
      if (!(e instanceof HttpErrorResponse) || (e.status !== 403 && e.status !== 404) || !live) throw e;
    }
    if (live) return live.definition;
    throw new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
  }

  // ---------------- case sheets ----------------

  async listCases(q: {
    state?: CaseState;
    search?: string;
    patientId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Page<CaseSummary>> {
    let p = new HttpParams();
    if (q.state) p = p.set('state', q.state);
    if (q.patientId) p = p.set('patientId', q.patientId);
    if (q.search?.trim()) p = p.set('q', q.search.trim());
    if (q.page) p = p.set('page', q.page);
    if (q.pageSize) p = p.set('pageSize', q.pageSize);
    const r = obj(await this.get('/api/casesheets/sheets', p));
    return {
      items: arr(r['items']).map(toCaseSummary),
      total: num(r['total']),
      page: num(r['page'], 1),
      pageSize: num(r['pageSize'], 30),
    };
  }

  async createCase(formId: string, patient?: Partial<PatientBlock>, link?: CaseLink): Promise<CaseSheet> {
    const body: Record<string, unknown> = { formId, patient: patient ?? null };
    // lab: the LMS patient (+ what it was started from; phase 1 = the patient itself, plan §7)
    if (link) Object.assign(body, { patientId: link.patientId, contextKind: link.contextKind ?? 'patient', contextId: link.contextId ?? null });
    return toCaseSheet(await this.send('POST', '/api/casesheets/sheets', body));
  }

  async getCase(id: string): Promise<CaseSheet> {
    return toCaseSheet(await this.get(`/api/casesheets/sheets/${enc(id)}`));
  }

  async saveCase(id: string, body: CaseSave): Promise<SaveAck> {
    return toAck(await this.send('PATCH', `/api/casesheets/sheets/${enc(id)}`, body));
  }

  async narrative(id: string): Promise<CaseNarrative> {
    return toNarrative(await this.get(`/api/casesheets/sheets/${enc(id)}/narrative`));
  }

  async editSection(id: string, sectionId: string, text: string, rowVersion: number): Promise<SaveAck> {
    return toAck(
      await this.send('PUT', `/api/casesheets/sheets/${enc(id)}/narrative/sections/${enc(sectionId)}`, { rowVersion, text }),
    );
  }

  async clearSection(id: string, sectionId: string, rowVersion: number): Promise<SaveAck> {
    return toAck(
      await this.send(
        'DELETE',
        `/api/casesheets/sheets/${enc(id)}/narrative/sections/${enc(sectionId)}`,
        undefined,
        new HttpParams().set('rowVersion', rowVersion),
      ),
    );
  }

  async renameSection(id: string, sectionId: string, title: string, rowVersion: number): Promise<SaveAck> {
    return toAck(
      await this.send('PUT', `/api/casesheets/sheets/${enc(id)}/narrative/sections/${enc(sectionId)}/title`, {
        rowVersion,
        title,
      }),
    );
  }

  async addOwnSection(
    id: string,
    section: { title: string; text: string },
    rowVersion: number,
  ): Promise<SaveAck & { sectionId: string }> {
    const r = await this.send('POST', `/api/casesheets/sheets/${enc(id)}/narrative/own-sections`, { rowVersion, ...section });
    return { ...toAck(r), sectionId: str(obj(r)['sectionId']) };
  }

  async finishCase(id: string, rowVersion: number): Promise<CaseSheet> {
    return toCaseSheet(await this.send('POST', `/api/casesheets/sheets/${enc(id)}/finish`, { rowVersion }));
  }

  async amendCase(id: string): Promise<CaseSheet> {
    return toCaseSheet(await this.send('POST', `/api/casesheets/sheets/${enc(id)}/amend`, {}));
  }

  async deleteCase(id: string): Promise<void> {
    await this.send('DELETE', `/api/casesheets/sheets/${enc(id)}`);
  }

  casePdf(id: string): Promise<Blob> {
    return this.call(() =>
      firstValueFrom(this.http.get(api(`/api/casesheets/sheets/${enc(id)}/pdf`), { responseType: 'blob' })),
    );
  }

  async pdfLink(id: string): Promise<PdfLink> {
    const r = obj(await this.send('POST', `/api/casesheets/sheets/${enc(id)}/pdf-link`, {}));
    return { url: absolute(str(r['url'])), expiresAt: str(r['expiresAt']) };
  }

  async narrativePreview(formVersionId: string, answers: Answers, visitedPages?: string[]): Promise<CaseNarrative> {
    const r = await this.send('POST', '/api/casesheets/narrative/preview', {
      formVersionId,
      answers,
      visitedPages: visitedPages ?? null,
    });
    return toNarrative(r);
  }

  // ---------------- practice settings ----------------

  async getPractice(): Promise<PracticeSettings> {
    return toPractice(await this.get('/api/casesheets/practice-settings'));
  }

  async savePractice(s: PracticeSettings): Promise<PracticeSettings> {
    const body = {
      practiceName: nul(s.practiceName),
      doctorName: nul(s.doctorName),
      addressLine1: nul(s.addressLine1),
      addressLine2: nul(s.addressLine2),
      phone: nul(s.phone),
      email: nul(s.email),
      website: nul(s.website),
      enabled: s.enabled,
    };
    return toPractice(await this.send('PUT', '/api/casesheets/practice-settings', body));
  }

  async uploadPracticeImage(kind: 'logo' | 'signature', file: Blob): Promise<PracticeSettings> {
    const r = await this.call(() =>
      firstValueFrom(
        this.http.put(api(`/api/casesheets/practice-settings/${kind}`), file, {
          headers: new HttpHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
        }),
      ),
    );
    return r && typeof r === 'object' ? toPractice(r) : this.getPractice();
  }

  async removePracticeImage(kind: 'logo' | 'signature'): Promise<PracticeSettings> {
    await this.send('DELETE', `/api/casesheets/practice-settings/${kind}`);
    return this.getPractice();
  }

  // ---------------- voice ----------------

  async transcribe(audio: Blob, context: { label: string; specialty?: string; durationMs?: number }): Promise<string> {
    let p = new HttpParams().set('label', context.label.slice(0, 100));
    if (context.specialty) p = p.set('specialty', context.specialty.slice(0, 100));
    if (context.durationMs) p = p.set('durationMs', Math.round(context.durationMs));
    const r = obj(
      await this.call(() =>
        firstValueFrom(
          this.http.post(api('/api/casesheets/voice/transcribe'), audio, {
            params: p,
            headers: new HttpHeaders({ 'Content-Type': (audio.type || 'audio/webm').split(';')[0] }),
          }),
        ),
      ),
    );
    return str(r['text']).trim();
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

/** The API answers signed file links as paths (`/api/casesheets/files/…`): make them absolute on the API host. */
function absolute(url: string): string {
  return /^https?:\/\//i.test(url) ? url : api(url);
}
