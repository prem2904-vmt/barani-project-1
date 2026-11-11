import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Answers, FormDefinition, allFields, isAnswered, missingRequired, patientLabelOf } from '@prefrontal/forms-engine';
import { ENT_SAMPLE } from '@prefrontal/forms-engine/testing';
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
  PracticeSettings,
  PublishedForm,
  SaveAck,
  Suggestion,
} from './case-models';
import { CasesApi } from './cases-api';

interface StoredSheet {
  sheet: CaseSheet;
  edits: Record<string, MockEdit>;
  lastSaveId: string | null;
  deleted: boolean;
  frozen: CaseNarrative | null;
}

interface MockEdit {
  text: string | null;
  basedOn: string;
  title?: string | null;
  own?: boolean;
  order?: number;
}

interface MockSuggestion extends Suggestion {
  formId: string;
  field: string;
  last: number;
}

/** The fields whose wording the API learns at Finish (mirrors SuggestionLearner: text, plain, suggestions on, never the patient's name). */
function learns(f: { kind: string; key: string; label: string; config?: Record<string, unknown> }): boolean {
  const name = /^(patient[\s_-]?)?(full[\s_-]?)?name$|^patient('?s)? name$/i;
  return (
    f.kind === 'text' &&
    f.config?.['suggestions'] !== false &&
    ['plain', undefined].includes(f.config?.['format'] as string | undefined) &&
    !name.test(f.key.trim()) &&
    !name.test(f.label.trim())
  );
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A tiny, valid one-page PDF ("Case sheet"). */
export const MOCK_PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
    '4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 72 760 Td (Case sheet) Tj ET\nendstream endobj\n' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/**
 * An in-memory API with the server's rules: row versions bump on every
 * write, a stale row version is a 409 carrying the current copy, a retried
 * requestId is answered without a conflict, Finish refuses with the missing
 * answers (422), finished sheets are read-only, Amend reuses an open
 * amendment. Seeded with the ENT sample form. Unit tests and the offline
 * demo use it; it never pretends to be the narrative engine (its sentences
 * are a plain "Label: value" list).
 */
@Injectable()
export class MockCasesApi extends CasesApi {
  /** Set to make every call fail as if offline (status 0). */
  offline = false;
  /** Calls, for specs. */
  readonly calls: { op: string; args: unknown[] }[] = [];

  private seq = 0;
  private now = Date.parse('2026-11-01T09:00:00Z');
  readonly forms = new Map<
    string,
    {
      title: string;
      specialty: string | null;
      departmentKey: string | null;
      key: string;
      versionId: string;
      versionNo: number;
      definition: FormDefinition;
    }
  >();
  readonly sheets = new Map<string, StoredSheet>();
  readonly pins = new Set<string>();
  /** Master departments (plan §3.3); specs seed them. */
  readonly departments: CaseSheetDepartment[] = [];
  readonly suggestionRows: MockSuggestion[] = [];
  private practice: PracticeSettings = {
    practiceName: '',
    doctorName: '',
    addressLine1: '',
    addressLine2: '',
    phone: '',
    email: '',
    website: '',
    enabled: true,
    logo: null,
    signature: null,
  };

  constructor() {
    super();
    this.addForm('form-ent', ENT_SAMPLE, 'ent-nose');
  }

  addForm(id: string, definition: FormDefinition, key = id, departmentKey: string | null = null): void {
    this.forms.set(id, {
      title: definition.title ?? key,
      specialty: definition.specialty ?? null,
      departmentKey,
      key,
      versionId: `${id}-v1`,
      versionNo: 1,
      definition: clone(definition),
    });
  }

  private tick(): string {
    this.now += 1000;
    return new Date(this.now).toISOString();
  }

  private async gate(op: string, ...args: unknown[]): Promise<void> {
    this.calls.push({ op, args });
    await Promise.resolve();
    if (this.offline) throw new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
  }

  private notFound(): never {
    throw new HttpErrorResponse({ status: 404, statusText: 'Not Found', error: { code: 'not_found' } });
  }

  private mine(id: string): StoredSheet {
    const s = this.sheets.get(id);
    if (!s || s.deleted) this.notFound();
    return s;
  }

  private formOf(sheet: CaseSheet) {
    const f = this.forms.get(sheet.formId);
    if (!f) this.notFound();
    return f;
  }

  private bump(s: StoredSheet): SaveAck {
    s.sheet.rowVersion += 1;
    s.sheet.updatedAt = this.tick();
    return { id: s.sheet.id, state: s.sheet.state, rowVersion: s.sheet.rowVersion, updatedAt: s.sheet.updatedAt };
  }

  private expect(s: StoredSheet, rowVersion: number): void {
    if (s.sheet.state !== 'draft') throw new CaseFinal();
    if (rowVersion !== s.sheet.rowVersion) throw new CaseConflict(clone(s.sheet));
  }

  // ---------------- forms ----------------

  async listForms(): Promise<FormSummary[]> {
    await this.gate('listForms');
    return [...this.forms.entries()].map(([id, f]) => ({
      id,
      key: f.key,
      title: f.title,
      specialty: this.departments.find((d) => d.key === f.departmentKey)?.name ?? f.specialty,
      departmentKey: f.departmentKey,
      publishedVersionId: f.versionId,
      versionNo: f.versionNo,
      publishedAt: '2026-10-30T10:00:00Z',
      pinned: this.pins.has(id),
    })).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }

  async listDepartments(): Promise<CaseSheetDepartment[]> {
    await this.gate('listDepartments');
    return clone(this.departments).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async pinForm(formId: string, pinned: boolean): Promise<void> {
    await this.gate('pinForm', formId, pinned);
    if (!this.forms.has(formId)) this.notFound();
    if (pinned) this.pins.add(formId);
    else this.pins.delete(formId);
  }

  async suggestions(formId: string, field: string, q?: string, limit = 5): Promise<Suggestion[]> {
    await this.gate('suggestions', formId, field, q, limit);
    const term = q?.trim().toLowerCase() ?? '';
    return this.suggestionRows
      .filter((r) => r.formId === formId && r.field === field && (!term || r.text.toLowerCase().includes(term)))
      .sort((a, b) => b.uses - a.uses || b.last - a.last)
      .slice(0, Math.min(Math.max(limit, 1), 20))
      .map(({ id, text, uses }) => ({ id, text, uses }));
  }

  async deleteSuggestion(id: string): Promise<void> {
    await this.gate('deleteSuggestion', id);
    const i = this.suggestionRows.findIndex((r) => r.id === id);
    if (i < 0) this.notFound();
    this.suggestionRows.splice(i, 1);
  }

  /** Seed a suggestion (specs / E2E). */
  addSuggestion(formId: string, field: string, text: string, uses = 1): void {
    this.suggestionRows.push({ id: `sg-${++this.seq}`, formId, field, text, uses, last: (this.now += 1) });
  }

  private learn(sheet: CaseSheet): void {
    const def = this.formOf(sheet).definition;
    for (const f of allFields(def)) {
      const v = sheet.answers[f.key];
      if (!learns(f) || typeof v !== 'string' || v.trim().length < 3) continue;
      const text = v.trim().slice(0, 1000);
      const hit = this.suggestionRows.find(
        (r) => r.formId === sheet.formId && r.field === f.key && r.text.toLowerCase() === text.toLowerCase(),
      );
      if (hit) {
        hit.uses += 1;
        hit.last = this.now;
      } else this.addSuggestion(sheet.formId, f.key, text);
    }
  }

  async publishedForm(formId: string): Promise<PublishedForm> {
    await this.gate('publishedForm', formId);
    const f = this.forms.get(formId) ?? this.notFound();
    return { formId, versionId: f.versionId, versionNo: f.versionNo, definition: clone(f.definition) };
  }

  async formVersion(formId: string): Promise<FormDefinition> {
    return (await this.publishedForm(formId)).definition;
  }

  // ---------------- sheets ----------------

  async listCases(q: {
    state?: CaseState;
    search?: string;
    patientId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Page<CaseSummary>> {
    await this.gate('listCases', q);
    const term = q.search?.trim().toLowerCase() ?? '';
    const all = [...this.sheets.values()]
      .filter((s) => !s.deleted)
      .filter((s) => !q.state || s.sheet.state === q.state)
      .filter((s) => !q.patientId || s.sheet.patientId === q.patientId)
      .filter((s) => !term || (s.sheet.patient.name ?? '').toLowerCase().includes(term))
      .sort((a, b) => b.sheet.updatedAt.localeCompare(a.sheet.updatedAt));
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 30;
    const items = all.slice((page - 1) * pageSize, page * pageSize).map(({ sheet: c }) => ({
      id: c.id,
      state: c.state,
      formId: c.formId,
      formTitle: c.formTitle,
      formVersionId: c.formVersionId,
      patientId: c.patientId,
      patientName: c.patient.name,
      patientAge: c.patient.age,
      patientSex: c.patient.sex,
      lastPage: c.visitedPages.length ? c.visitedPages[c.visitedPages.length - 1] : null,
      updatedAt: c.updatedAt,
      finalisedAt: c.finalisedAt,
      hasPdf: c.hasPdf,
      rowVersion: c.rowVersion,
      amendedFromId: c.amendedFromId,
      source: c.source,
    }));
    return { items, total: all.length, page, pageSize };
  }

  async createCase(formId: string, patient?: Partial<PatientBlock>, link?: CaseLink): Promise<CaseSheet> {
    await (link ? this.gate('createCase', formId, patient, link) : this.gate('createCase', formId, patient));
    const f = this.forms.get(formId) ?? this.notFound();
    const at = this.tick();
    const sheet: CaseSheet = {
      id: `case-${++this.seq}`,
      state: 'draft',
      formId,
      formTitle: f.title,
      formVersionId: f.versionId,
      formVersionNo: f.versionNo,
      patientId: link?.patientId ?? null,
      patient: {
        name: patient?.name ?? null,
        age: patient?.age ?? null,
        sex: patient?.sex ?? null,
        ref: patient?.ref ?? null,
      },
      answers: defaultsOf(f.definition),
      visitedPages: [],
      rowVersion: 1,
      createdAt: at,
      updatedAt: at,
      finalisedAt: null,
      amendedFromId: null,
      hasPdf: false,
      source: 'human',
    };
    this.sheets.set(sheet.id, { sheet, edits: {}, lastSaveId: null, deleted: false, frozen: null });
    return clone(sheet);
  }

  async getCase(id: string): Promise<CaseSheet> {
    await this.gate('getCase', id);
    return clone(this.mine(id).sheet);
  }

  async saveCase(id: string, body: CaseSave): Promise<SaveAck> {
    await this.gate('saveCase', id, clone(body));
    const s = this.mine(id);
    if (s.sheet.state !== 'draft') throw new CaseFinal();
    if (body.requestId && s.lastSaveId === body.requestId)
      return { id, state: s.sheet.state, rowVersion: s.sheet.rowVersion, updatedAt: s.sheet.updatedAt };
    this.expect(s, body.rowVersion);
    const keys = new Set(allFields(this.formOf(s.sheet).definition).map((f) => f.key));
    const answers = { ...s.sheet.answers };
    for (const k of body.remove ?? []) delete answers[k];
    for (const [k, v] of Object.entries(body.answers ?? {})) {
      if (!keys.has(k))
        throw new HttpErrorResponse({
          status: 400,
          error: { code: 'unknown_field', title: `The case sheet has no field '${k}'.` },
        });
      answers[k] = clone(v);
    }
    s.sheet.answers = answers;
    if (body.patient) s.sheet.patient = { ...s.sheet.patient, ...body.patient };
    if (body.visitedPages) s.sheet.visitedPages = [...new Set(body.visitedPages)];
    s.lastSaveId = body.requestId ?? null;
    return this.bump(s);
  }

  private generate(sheet: CaseSheet): NarrativeSection[] {
    const def = this.formOf(sheet).definition;
    const fields = new Map(allFields(def).map((f) => [f.key, f]));
    const out: NarrativeSection[] = [];
    def.pages.forEach((p, i) => {
      const lines: string[] = [];
      for (const f of p.fields) {
        const v = sheet.answers[f.key];
        if (!isAnswered(v)) continue;
        lines.push(`${f.label}: ${describe(v, fields.get(f.key)?.options)}.`);
      }
      if (!lines.length) return;
      const content = lines.join(' ');
      out.push({
        id: p.key,
        key: p.key,
        title: p.title,
        order: i,
        generated: content,
        edited: null,
        stale: false,
        content,
        own: false,
        formTitle: null,
      });
    });
    return out;
  }

  private view(s: StoredSheet): CaseNarrative {
    const generated = this.generate(s.sheet).map((g) => {
      const e = s.edits[g.id];
      if (!e || e.own) return g;
      const titled = e.title ? { ...g, title: e.title, formTitle: g.title } : g;
      return e.text === null
        ? titled
        : { ...titled, edited: e.text, stale: e.basedOn !== g.generated, content: e.text };
    });
    let last = generated.reduce((m, g) => Math.max(m, g.order), 0);
    const own = Object.entries(s.edits)
      .filter(([, e]) => e.own)
      .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
      .map(
        ([id, e]): NarrativeSection => ({
          id,
          key: id,
          title: e.title ?? '',
          order: ++last,
          generated: '',
          edited: e.text,
          stale: false,
          content: e.text ?? '',
          own: true,
          formTitle: null,
        }),
      );
    const sections = [...generated, ...own];
    const p = s.sheet.patient;
    return {
      state: s.sheet.state,
      rowVersion: s.sheet.rowVersion,
      frozen: false,
      patientName: p.name ?? patientLabelOf(this.formOf(s.sheet).definition, s.sheet.answers) ?? '',
      age: p.age,
      sex: p.sex,
      sections,
      warnings: [],
    };
  }

  async narrative(id: string): Promise<CaseNarrative> {
    await this.gate('narrative', id);
    const s = this.mine(id);
    return clone(s.frozen ?? this.view(s));
  }

  async editSection(id: string, sectionId: string, text: string, rowVersion: number): Promise<SaveAck> {
    await this.gate('editSection', id, sectionId, text, rowVersion);
    const s = this.mine(id);
    this.expect(s, rowVersion);
    const was = s.edits[sectionId];
    if (was?.own) {
      s.edits[sectionId] = { ...was, text: text.trim() };
      return this.bump(s);
    }
    const g = this.generate(s.sheet).find((x) => x.id === sectionId);
    if (!g) this.notFound();
    s.edits[sectionId] = { ...was, text: text.trim(), basedOn: g.generated };
    return this.bump(s);
  }

  async renameSection(id: string, sectionId: string, title: string, rowVersion: number): Promise<SaveAck> {
    await this.gate('renameSection', id, sectionId, title, rowVersion);
    const s = this.mine(id);
    this.expect(s, rowVersion);
    const was = s.edits[sectionId];
    const t = title.trim() || null;
    if (was?.own) s.edits[sectionId] = { ...was, title: t ?? '' };
    else {
      if (!was && !this.generate(s.sheet).some((x) => x.id === sectionId)) this.notFound();
      if (!t && (was?.text ?? null) === null) delete s.edits[sectionId];
      else s.edits[sectionId] = { text: was?.text ?? null, basedOn: was?.basedOn ?? '', title: t };
    }
    return this.bump(s);
  }

  async addOwnSection(
    id: string,
    section: { title: string; text: string },
    rowVersion: number,
  ): Promise<SaveAck & { sectionId: string }> {
    await this.gate('addOwnSection', id, section, rowVersion);
    const s = this.mine(id);
    this.expect(s, rowVersion);
    const own = Object.values(s.edits).filter((e) => e.own);
    const sectionId = `own-${++this.seq}`;
    s.edits[sectionId] = {
      text: section.text.trim(),
      basedOn: '',
      title: section.title.trim(),
      own: true,
      order: own.reduce((m, e) => Math.max(m, e.order ?? 0), 0) + 1,
    };
    return { ...this.bump(s), sectionId };
  }

  async clearSection(id: string, sectionId: string, rowVersion: number): Promise<SaveAck> {
    await this.gate('clearSection', id, sectionId, rowVersion);
    const s = this.mine(id);
    this.expect(s, rowVersion);
    const was = s.edits[sectionId];
    if (was && !was.own && was.title) s.edits[sectionId] = { ...was, text: null };
    else delete s.edits[sectionId];
    return this.bump(s);
  }

  async finishCase(id: string, rowVersion: number): Promise<CaseSheet> {
    await this.gate('finishCase', id, rowVersion);
    const s = this.mine(id);
    this.expect(s, rowVersion);
    const def = this.formOf(s.sheet).definition;
    const missing: MissingAnswer[] = missingRequired(def, s.sheet.answers).map((m) => ({
      page: m.pageId,
      pageTitle: m.pageTitle,
      field: m.fieldKey,
      label: m.label,
    }));
    const name = s.sheet.patient.name ?? patientLabelOf(def, s.sheet.answers);
    if (!name) missing.unshift({ page: 'patient', pageTitle: 'Patient', field: 'patient.name', label: 'Patient name' });
    if (missing.length) throw new FinishRefused(missing);
    s.frozen = { ...this.view(s), frozen: true, state: 'final' };
    this.learn(s.sheet);
    s.sheet.state = 'final';
    s.sheet.finalisedAt = this.tick();
    s.sheet.patient.name = name;
    s.sheet.hasPdf = true;
    this.bump(s);
    s.frozen.rowVersion = s.sheet.rowVersion;
    return clone(s.sheet);
  }

  async amendCase(id: string): Promise<CaseSheet> {
    await this.gate('amendCase', id);
    const src = this.mine(id);
    if (src.sheet.state !== 'final')
      throw new HttpErrorResponse({
        status: 409,
        error: { code: 'not_final', title: 'Only a finished case sheet can be amended.' },
      });
    const open = [...this.sheets.values()].find(
      (x) => !x.deleted && x.sheet.amendedFromId === id && x.sheet.state === 'draft',
    );
    if (open) return clone(open.sheet);
    const at = this.tick();
    const sheet: CaseSheet = {
      ...clone(src.sheet),
      id: `case-${++this.seq}`,
      state: 'draft',
      rowVersion: 1,
      createdAt: at,
      updatedAt: at,
      finalisedAt: null,
      hasPdf: false,
      amendedFromId: id,
    };
    this.sheets.set(sheet.id, { sheet, edits: clone(src.edits), lastSaveId: null, deleted: false, frozen: null });
    return clone(sheet);
  }

  async deleteCase(id: string): Promise<void> {
    await this.gate('deleteCase', id);
    this.mine(id).deleted = true;
  }

  async casePdf(id: string): Promise<Blob> {
    await this.gate('casePdf', id);
    this.mine(id);
    return new Blob([MOCK_PDF_BYTES], { type: 'application/pdf' });
  }

  async narrativePreview(formVersionId: string, answers: Answers, visitedPages?: string[]): Promise<CaseNarrative> {
    await this.gate('narrativePreview', formVersionId, answers, visitedPages);
    const entry = [...this.forms.entries()].find(([, f]) => f.versionId === formVersionId) ?? this.notFound();
    const fake: CaseSheet = {
      id: 'preview',
      state: 'draft',
      formId: entry[0],
      formTitle: entry[1].title,
      formVersionId,
      formVersionNo: 1,
      patientId: null,
      patient: { name: null, age: null, sex: null, ref: null },
      answers,
      visitedPages: visitedPages ?? [],
      rowVersion: 0,
      createdAt: '',
      updatedAt: '',
      finalisedAt: null,
      amendedFromId: null,
      hasPdf: false,
      source: 'human',
    };
    return {
      state: 'draft',
      rowVersion: 0,
      frozen: false,
      patientName: patientLabelOf(entry[1].definition, answers) ?? '',
      age: null,
      sex: null,
      sections: this.generate(fake),
      warnings: [],
    };
  }

  // ---------------- practice ----------------

  async getPractice(): Promise<PracticeSettings> {
    await this.gate('getPractice');
    return clone(this.practice);
  }

  async savePractice(s: PracticeSettings): Promise<PracticeSettings> {
    await this.gate('savePractice', clone(s));
    const trim = (x: string) => x.trim();
    this.practice = {
      ...this.practice,
      practiceName: trim(s.practiceName),
      doctorName: trim(s.doctorName),
      addressLine1: trim(s.addressLine1),
      addressLine2: trim(s.addressLine2),
      phone: trim(s.phone),
      email: trim(s.email),
      website: trim(s.website),
      enabled: s.enabled,
    };
    return clone(this.practice);
  }

  async uploadPracticeImage(kind: 'logo' | 'signature', file: Blob): Promise<PracticeSettings> {
    await this.gate('uploadPracticeImage', kind, file.type);
    if (!/^image\/(png|jpeg)$/.test(file.type))
      throw new HttpErrorResponse({
        status: 400,
        error: { code: 'unsupported_image', title: 'Use a PNG or a JPEG picture.' },
      });
    this.practice[kind] = { url: `http://localhost:5280/api/casesheets/practice-settings/${kind}?v=mock`, width: 200, height: 80 };
    return clone(this.practice);
  }

  async removePracticeImage(kind: 'logo' | 'signature'): Promise<PracticeSettings> {
    await this.gate('removePracticeImage', kind);
    this.practice[kind] = null;
    return clone(this.practice);
  }

  // ---------------- voice ----------------

  async transcribe(audio: Blob, context: { label: string }): Promise<string> {
    await this.gate('transcribe', audio.size, context);
    return `dictated for ${context.label}`;
  }
}

/** The form's default answers (mirrors the API's DefaultAnswers: fields on pages + option follow-ups, never repeats, never blanks). */
export function defaultsOf(def: FormDefinition): Answers {
  const out: Answers = {};
  const seed = (f: FormDefinition['pages'][number]['fields'][number]) => {
    const d = f.default;
    const blank = d === undefined || d === null || (typeof d === 'string' && !d.trim());
    if (!blank && f.kind !== 'repeat' && f.kind !== 'repeatPages' && !(f.key in out)) out[f.key] = clone(d);
    for (const o of f.options ?? []) for (const sub of o.subFields ?? []) seed(sub);
  };
  for (const p of def.pages) for (const f of p.fields) seed(f);
  return out;
}

function describe(v: unknown, options?: { key: string; label: string }[]): string {
  const label = (k: unknown) =>
    options?.find((o) => o.key.toLowerCase() === String(k).toLowerCase())?.label ?? String(k);
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('amount' in o || 'value' in o)
      return [o['amount'] ?? o['value'], o['unit']].filter((x) => x !== undefined && x !== null).join(' ');
    if (Array.isArray(o['dimensions']))
      return `${(o['dimensions'] as unknown[]).join(' x ')} ${o['unit'] ?? ''}`.trim();
    return JSON.stringify(v);
  }
  return label(v);
}
