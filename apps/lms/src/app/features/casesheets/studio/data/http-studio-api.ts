import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Answers, FormDefinition } from '@prefrontal/forms-engine';
// light entry: this service is provided at the root, so it must not pull the whole engine into the first download
import { toNarrativeTables } from '@prefrontal/forms-engine/providers';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import type { StudioApi } from './studio-api';
import {
  ComponentKind,
  DiffChange,
  DraftConflict,
  Editor,
  DepartmentRow,
  DraftFromSheetInput,
  DraftJob,
  FormDetail,
  FormOrigin,
  FormRow,
  ImportItem,
  ImportResult,
  LivePreview,
  Page,
  Person,
  Problem,
  PublishRefused,
  StudioError,
  TemplateKind,
  TemplateRow,
  Version,
  VersionDiff,
  VersionRow,
  VersionState,
} from './studio-models';

const api = (path: string): string => environment.apiUrl.replace(/\/+$/, '') + path;

/* ---------------- wire → models (prefrontal-prepare-mw, Phase 3) ---------------- */

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const state = (v: unknown): VersionState =>
  v === 'in_review' || v === 'published' || v === 'retired' ? v : 'draft';

export function toPerson(v: unknown): Person | null {
  if (!v || typeof v !== 'object') return null;
  const p = obj(v);
  return { id: str(p['id']), name: strOrNull(p['name']), email: str(p['email']) };
}

export function toProblem(v: unknown): Problem {
  const p = obj(v);
  return {
    severity: p['severity'] === 'error' ? 'error' : 'warning',
    path: str(p['path']),
    pageKey: strOrNull(p['pageKey']),
    pageTitle: strOrNull(p['pageTitle']),
    fieldKey: strOrNull(p['fieldKey']),
    fieldLabel: strOrNull(p['fieldLabel']),
    where: str(p['where']),
    message: str(p['message']),
    summary: str(p['summary']) || str(p['message']),
  };
}

export function toVersion(v: unknown): Version {
  const x = obj(v);
  return {
    id: str(x['id']),
    formId: str(x['formId']),
    versionNo: num(x['versionNo']),
    state: state(x['state']),
    source: str(x['source']) || 'human',
    note: strOrNull(x['note']),
    rowVersion: num(x['rowVersion']),
    createdAt: str(x['createdAt']),
    updatedAt: str(x['updatedAt']),
    publishedAt: strOrNull(x['publishedAt']),
    savedBy: toPerson(x['savedBy']),
    definition: x['definition'] && typeof x['definition'] === 'object' ? (x['definition'] as FormDefinition) : null,
    problems: arr(x['problems']).map(toProblem),
    editors: arr(x['editors']).map(toEditor),
  };
}

function toEditor(v: unknown): Editor {
  const e = obj(v);
  return { userId: str(e['userId']), name: str(e['name']) || 'Someone', seenAt: str(e['seenAt']) };
}

export function toOrigin(v: unknown): FormOrigin {
  return v === 'master' || v === 'override' ? v : 'local';
}

export function toFormRow(v: unknown): FormRow {
  const f = obj(v);
  const p = f['published'] ? obj(f['published']) : null;
  const d = f['draft'] ? obj(f['draft']) : null;
  return {
    id: str(f['id']),
    key: str(f['key']),
    title: str(f['title']),
    specialty: strOrNull(f['specialty']),
    status: f['status'] === 'archived' ? 'archived' : 'active',
    origin: toOrigin(f['origin']),
    departmentKey: strOrNull(f['departmentKey']) ?? strOrNull(f['specialty']),
    departmentName: strOrNull(f['departmentName']),
    catalogKey: strOrNull(f['catalogKey']),
    readOnly: f['readOnly'] === true,
    forkedFromVersionId: strOrNull(f['forkedFromVersionId']),
    pinned: f['pinned'] === true,
    newerMaster: f['newerMaster'] === true,
    published: p ? { id: str(p['id']), versionNo: num(p['versionNo']), publishedAt: strOrNull(p['publishedAt']) } : null,
    draft: d
      ? {
          id: str(d['id']),
          versionNo: num(d['versionNo']),
          state: state(d['state']),
          source: str(d['source']) || 'human',
          updatedAt: str(d['updatedAt']),
          rowVersion: num(d['rowVersion']),
        }
      : null,
  };
}

function toVersionRow(v: unknown): VersionRow {
  const x = obj(v);
  return {
    id: str(x['id']),
    versionNo: num(x['versionNo']),
    state: state(x['state']),
    source: str(x['source']) || 'human',
    note: strOrNull(x['note']),
    createdAt: str(x['createdAt']),
    updatedAt: str(x['updatedAt']),
    publishedAt: strOrNull(x['publishedAt']),
    createdBy: toPerson(x['createdBy']),
    savedBy: toPerson(x['savedBy']),
    publishedBy: toPerson(x['publishedBy']),
  };
}

export function toDiff(v: unknown): VersionDiff {
  const x = obj(v);
  const side = (s: unknown) => {
    const o = obj(s);
    return { id: str(o['id']), versionNo: num(o['versionNo']), state: state(o['state']) };
  };
  const summary = obj(x['summary']);
  return {
    from: side(x['from']),
    to: side(x['to']),
    headline: str(summary['headline']) || 'No changes',
    total: num(summary['total']),
    changes: arr(x['changes']).map((c): DiffChange => {
      const o = obj(c);
      return {
        type: str(o['type']),
        pageKey: strOrNull(o['pageKey']),
        pageTitle: strOrNull(o['pageTitle']),
        fieldKey: strOrNull(o['fieldKey']),
        fieldLabel: strOrNull(o['fieldLabel']),
        what: strOrNull(o['what']),
        before: strOrNull(o['before']),
        after: strOrNull(o['after']),
        words: str(o['words']),
      };
    }),
  };
}

export function toPreview(v: unknown): LivePreview {
  const x = obj(v);
  return {
    sections: arr(x['sections']).map((s) => {
      const o = obj(s);
      return {
        key: str(o['key']),
        title: str(o['title']),
        order: num(o['order']),
        content: str(o['content']),
        fieldKeys: arr(o['fieldKeys']).filter((k): k is string => typeof k === 'string'),
        tables: toNarrativeTables(o['tables']),
      };
    }),
    tables: toNarrativeTables(x['tables']),
    warnings: arr(x['warnings']).filter((w): w is string => typeof w === 'string'),
    problems: arr(x['problems']).map(toProblem),
    answers: x['answers'] && typeof x['answers'] === 'object' ? (x['answers'] as Answers) : null,
  };
}

function toTemplate(v: unknown): TemplateRow {
  const t = obj(v);
  return {
    id: str(t['id']),
    kind: t['kind'] === 'page' ? 'page' : 'field',
    title: str(t['title']),
    category: strOrNull(t['category']),
    description: strOrNull(t['description']),
    rowVersion: num(t['rowVersion']),
  };
}

export function toImport(v: unknown): ImportResult {
  const x = obj(v);
  const r = obj(x['report']);
  const c = obj(r['counts']);
  return {
    saved: x['saved'] === true,
    formId: strOrNull(x['formId']),
    versionId: strOrNull(x['versionId']),
    definition: (x['definition'] ?? { pages: [] }) as FormDefinition,
    report: {
      summary: str(r['summary']),
      canPublish: r['canPublish'] !== false,
      counts: {
        pages: num(c['pages']),
        fields: num(c['fields']),
        unsupported: num(c['unsupported']),
        attention: num(c['attention']),
        problems: num(c['problems']),
      },
      items: arr(r['items']).map((i): ImportItem => {
        const o = obj(i);
        const level = o['level'] === 'problem' || o['level'] === 'info' ? o['level'] : 'attention';
        return {
          level,
          pageKey: strOrNull(o['pageKey']),
          pageTitle: strOrNull(o['pageTitle']),
          fieldKey: strOrNull(o['fieldKey']),
          fieldLabel: strOrNull(o['fieldLabel']),
          message: str(o['message']),
        };
      }),
    },
  };
}

/** The diff summary: a list of plain lines, or one line of text. */
function toSummary(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return arr(v)
    .map((x) => (typeof x === 'string' ? x : str(obj(x)['text']) || str(obj(x)['summary'])))
    .filter((x) => !!x.trim());
}

/**
 * The real Studio API. Refusals become typed errors with the API's own
 * plain words: 409 `someone_else_saved` → DraftConflict (their copy and
 * name attached), 422 `form_has_errors` / `title_missing` → PublishRefused,
 * any other problem+json → StudioError. Network failures pass through
 * (status 0) so the screen can say "Can't reach the server".
 */
@Injectable({ providedIn: 'root' })
export class HttpStudioApi implements StudioApi {
  private readonly http = inject(HttpClient);

  private async call<T>(req: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(req);
    } catch (e) {
      throw mapError(e);
    }
  }

  async listForms(status: 'active' | 'archived' | 'all' = 'all'): Promise<FormRow[]> {
    // the API pages (100 at most per page): read every page
    const items: unknown[] = [];
    for (let page = 1; page <= 100; page++) {
      const params = new HttpParams().set('page', page).set('pageSize', 100).set('status', status);
      const r = obj(await this.call(this.http.get(api('/api/casesheets/forms'), { params })));
      const got = arr(r['items']);
      items.push(...got);
      const total = typeof r['total'] === 'number' ? (r['total'] as number) : 0;
      if (got.length < 100 || items.length >= total) break;
    }
    return items.map(toFormRow);
  }

  async form(formId: string): Promise<FormDetail> {
    const f = obj(await this.call(this.http.get(api(`/api/casesheets/forms/${formId}`))));
    return {
      id: str(f['id']),
      key: str(f['key']),
      title: str(f['title']),
      specialty: strOrNull(f['specialty']),
      status: f['status'] === 'archived' ? 'archived' : 'active',
      origin: toOrigin(f['origin']),
      departmentKey: strOrNull(f['departmentKey']),
      readOnly: f['readOnly'] === true,
      catalogKey: strOrNull(f['catalogKey']),
      forkedFromVersionId: strOrNull(f['forkedFromVersionId']),
      newerMaster: f['newerMaster'] === true,
      currentPublishedVersionId: strOrNull(f['currentPublishedVersionId']),
      versions: await this.versions(formId).catch(() => arr(f['versions']).map(toVersionRow)),
    };
  }

  private async versions(formId: string): Promise<VersionRow[]> {
    const r = obj(await this.call(this.http.get(api(`/api/casesheets/forms/${formId}/versions`), { params: { pageSize: 100 } })));
    return arr(r['items']).map(toVersionRow);
  }

  async version(formId: string, versionId: string): Promise<Version> {
    return toVersion(await this.call(this.http.get(api(`/api/casesheets/forms/${formId}/versions/${versionId}`))));
  }

  async createForm(title: string, definition?: FormDefinition, specialty?: string): Promise<{ id: string; version: Version }> {
    const r = obj(await this.call(this.http.post(api('/api/casesheets/forms'), { title, specialty, definition })));
    return { id: str(r['id']), version: toVersion(r['version']) };
  }

  async duplicate(formId: string, title?: string): Promise<{ id: string; version: Version }> {
    const r = obj(await this.call(this.http.post(api(`/api/casesheets/forms/${formId}/duplicate`), { title })));
    return { id: str(r['id']), version: toVersion(r['version']) };
  }

  async departments(): Promise<DepartmentRow[]> {
    const r = await this.call(this.http.get(api('/api/casesheets/departments')));
    const items = Array.isArray(r) ? r : arr(obj(r)['items']);
    return items
      .map((v) => {
        const d = obj(v);
        return { key: str(d['key']), name: str(d['name']), sortOrder: num(d['sortOrder']), isActive: d['isActive'] !== false };
      })
      .filter((d) => d.key && d.isActive)
      .map(({ key, name, sortOrder }) => ({ key, name: name || key, sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async fork(formId: string): Promise<{ id: string; version: Version }> {
    const r = obj(await this.call(this.http.post(api(`/api/casesheets/forms/${formId}/fork`), {})));
    return { id: str(r['id']), version: toVersion(r['version']) };
  }

  async archive(formId: string, archived: boolean): Promise<void> {
    await this.call(this.http.post(api(`/api/casesheets/forms/${formId}/${archived ? 'archive' : 'unarchive'}`), {}));
  }

  async startDraft(formId: string): Promise<Version> {
    return toVersion(await this.call(this.http.post(api(`/api/casesheets/forms/${formId}/draft`), {})));
  }

  async saveDraft(formId: string, definition: FormDefinition, rowVersion: number): Promise<Version> {
    return toVersion(await this.call(this.http.put(api(`/api/casesheets/forms/${formId}/draft`), { definition, rowVersion })));
  }

  async discardDraft(formId: string): Promise<void> {
    await this.call(this.http.delete(api(`/api/casesheets/forms/${formId}/draft`)));
  }

  async publish(formId: string, rowVersion?: number, note?: string): Promise<Version> {
    return toVersion(await this.call(this.http.post(api(`/api/casesheets/forms/${formId}/draft/publish`), { rowVersion, note })));
  }

  async restore(formId: string, versionId: string): Promise<Version> {
    return toVersion(await this.call(this.http.post(api(`/api/casesheets/forms/${formId}/versions/${versionId}/restore`), {})));
  }

  async diff(formId: string, from?: string, to?: string): Promise<VersionDiff> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return toDiff(await this.call(this.http.get(api(`/api/casesheets/forms/${formId}/diff`), { params })));
  }

  async livePreview(definition: FormDefinition, answers?: Answers): Promise<LivePreview> {
    return toPreview(await this.call(this.http.post(api('/api/casesheets/studio/preview'), { definition, answers })));
  }

  async components(): Promise<ComponentKind[]> {
    const r = obj(await this.call(this.http.get(api('/api/casesheets/components'))));
    return arr(r['kinds']).map((k) => {
      const o = obj(k);
      return {
        name: str(o['name']),
        title: str(o['title']),
        description: str(o['description']),
        usesOptions: o['usesOptions'] === true,
        usesChildren: o['usesChildren'] === true,
        defaults: obj(o['defaults']),
        configSchema: obj(o['configSchema']) as ComponentKind['configSchema'],
      };
    });
  }

  async templates(kind?: TemplateKind): Promise<TemplateRow[]> {
    let params = new HttpParams().set('pageSize', 100);
    if (kind) params = params.set('kind', kind);
    const r = obj(await this.call(this.http.get(api('/api/casesheets/templates'), { params })));
    return arr(r['items']).map(toTemplate);
  }

  async saveTemplate(kind: TemplateKind, title: string, body: unknown, category?: string): Promise<TemplateRow> {
    return toTemplate(await this.call(this.http.post(api('/api/casesheets/templates'), { kind, title, body, category })));
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.call(this.http.delete(api(`/api/casesheets/templates/${id}`)));
  }

  async expandTemplate(id: string, usedFieldKeys: string[], usedPageKeys: string[]): Promise<{ kind: TemplateKind; body: unknown }> {
    const r = obj(await this.call(this.http.post(api(`/api/casesheets/templates/${id}/expand`), { usedFieldKeys, usedPageKeys })));
    return { kind: r['kind'] === 'page' ? 'page' : 'field', body: r['body'] };
  }

  async importLegacy(legacy: unknown, opts: { dryRun: boolean; title?: string }): Promise<ImportResult> {
    return toImport(await this.call(this.http.post(api('/api/casesheets/forms/import'), { legacy, dryRun: opts.dryRun, title: opts.title })));
  }

  async draftFromSheet(input: DraftFromSheetInput): Promise<{ jobId: string }> {
    const body = new FormData();
    for (const f of input.files) body.append('files', f, f.name);
    body.append('departmentKey', input.departmentKey);
    if (input.title?.trim()) body.append('title', input.title.trim());
    const r = obj(await this.call(this.http.post(api('/api/casesheets/forms/draft-from-sheet'), body)));
    return { jobId: str(r['jobId']) };
  }

  async draftJob(jobId: string): Promise<DraftJob> {
    const r = obj(await this.call(this.http.get(api(`/api/casesheets/forms/draft-jobs/${encodeURIComponent(jobId)}`))));
    const s = str(r['status']);
    const status: DraftJob['status'] = (['queued', 'reading', 'building', 'checking', 'done', 'failed'] as const).find((x) => x === s) ?? 'queued';
    return {
      status,
      formId: strOrNull(r['formId']) ?? undefined,
      checkCount: typeof r['checkCount'] === 'number' ? (r['checkCount'] as number) : undefined,
      code: strOrNull(r['code']) ?? undefined,
      message: strOrNull(r['message']) ?? undefined,
    };
  }

  async presence(formId: string): Promise<Editor[]> {
    const r = obj(await this.call(this.http.post(api(`/api/casesheets/forms/${formId}/draft/presence`), {})));
    return arr(r['editors']).map(toEditor);
  }

  async leave(formId: string): Promise<void> {
    await this.call(this.http.delete(api(`/api/casesheets/forms/${formId}/draft/presence`)));
  }
}

/** problem+json → the typed Studio errors. */
export function mapError(e: unknown): unknown {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return e;
  const body = obj(e.error);
  const code = str(body['code']);
  const words = str(body['detail']) || str(body['title']);
  if (e.status === 409 && code === 'someone_else_saved' && body['current']) {
    return new DraftConflict(toVersion(body['current']), toPerson(body['savedBy']), words || undefined);
  }
  if (e.status === 422 && (code === 'form_has_errors' || code === 'title_missing')) {
    return new PublishRefused(arr(body['problems']).map(toProblem), str(body['title']) || undefined);
  }
  if (code) return new StudioError(code, words || "Couldn't do that just now.", e.status);
  return e;
}
