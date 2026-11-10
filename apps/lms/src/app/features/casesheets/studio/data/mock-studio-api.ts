import { Injectable } from '@angular/core';
import {
  Answers,
  FieldDef,
  FormDefinition,
  KIND_BUILDS,
  PlainKind,
  allFields,
  diffDefinitions,
  findField,
  locate,
  sampleAnswers,
  summariseChanges,
  addField,
  addPage,
  emptyDefinition,
  setLabel,
  updateField,
} from '@prefrontal/forms-engine';
import { StudioApi } from './studio-api';
import {
  ComponentKind,
  DraftConflict,
  Editor,
  DepartmentRow,
  DraftFromSheetInput,
  DraftJob,
  FormDetail,
  FormOrigin,
  FormRow,
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
} from './studio-models';

interface MForm {
  id: string;
  key: string;
  title: string;
  specialty: string | null;
  status: 'active' | 'archived';
  publishedId: string | null;
  origin: FormOrigin;
  departmentKey: string | null;
  forkedFrom?: string;
  versions: Version[];
}

const ME: Person = { id: 'u-me', name: 'Dr Meera Raghavan', email: 'meera@example.com' };
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

/** A tiny validator with the API's rules that Studio's screens react to (the API is the truth). */
export function mockProblems(def: FormDefinition): Problem[] {
  const out: Problem[] = [];
  const keys = new Set(allFields(def).map((f) => f.key));
  def.pages.forEach((p, pi) =>
    p.fields.forEach((f, fi) => {
      const walk = (x: FieldDef, path: string) => {
        const where = `${p.title} · ${x.label || 'A question'}`;
        const base = { pageKey: p.key, pageTitle: p.title, fieldKey: x.key, fieldLabel: x.label, where };
        const b = KIND_BUILDS[x.kind as PlainKind];
        if (b?.starterOptions && !(x.options ?? []).length)
          out.push({ severity: 'error', path: `${path}.options`, message: 'Add at least one choice.', summary: `${where}: add at least one choice.`, ...base });
        if (!x.label?.trim())
          out.push({ severity: 'warning', path: `${path}.label`, message: 'Give this question a name.', summary: `${where}: give this question a name.`, ...base });
        for (const c of x.showWhen?.conditions ?? [])
          if (!keys.has(c.field))
            out.push({
              severity: 'error',
              path: `${path}.showWhen`,
              message: '“Show when” uses a question that is no longer in the form.',
              summary: `${where}: “Show when” uses a question that is no longer in the form.`,
              ...base,
            });
        for (const o of x.options ?? []) (o.subFields ?? []).forEach((s, si) => walk(s, `${path}.options.subFields[${si}](${s.key})`));
      };
      walk(f, `pages[${pi}].fields[${fi}](${f.key})`);
    }),
  );
  return out;
}

/** Words from a definition + answers, the shape of the API's live preview (good enough for screens and tests). */
export function mockNarrative(def: FormDefinition, answers: Answers): LivePreview['sections'] {
  return (def.narrative?.sections ?? [])
    .map((s) => {
      const fieldKeys: string[] = [];
      const content = (s.template ?? '')
        .replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
          const f = findField(def, k);
          const v = answers[k];
          if (!f || v === undefined || v === null) return '';
          fieldKeys.push(k);
          const text = words(f, v);
          return f.says?.sentence ? f.says.sentence.replace('{value}', text) : text;
        })
        .replace(/\s+/g, ' ')
        .trim();
      return { key: s.key, title: s.title, order: s.order ?? 0, content, fieldKeys };
    })
    .filter((s) => s.content);
}

function words(f: FieldDef, v: unknown): string {
  const opt = (k: unknown) => {
    const o = f.options?.find((x) => x.key === k);
    return o ? o.says || o.label.toLowerCase() : String(k);
  };
  if (Array.isArray(v)) return v.map(opt).join(', ');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('amount' in o) return `${o['amount']} ${o['unit']}`;
    if ('value' in o) return `${o['value']} ${o['unit'] ?? ''}`.trim();
    if ('dimensions' in o) return `${(o['dimensions'] as number[]).join(' x ')} ${o['unit']}`;
    return '';
  }
  if (f.options?.length) return opt(v);
  return String(v);
}

/**
 * In-memory Studio with the API's rules: one open draft per form, row
 * versions (a stale save → DraftConflict with the other copy), publish
 * refused while there are errors, history kept, templates, masters and
 * forks. For unit tests and the mocked E2E world.
 */
@Injectable()
export class MockStudioApi extends StudioApi {
  readonly forms = new Map<string, MForm>();
  readonly tpl = new Map<string, TemplateRow & { body: unknown }>();
  editors: Editor[] = [];
  /** Calls, for specs. */
  readonly calls: string[] = [];
  delayMs = 0;

  private async tick(name: string): Promise<void> {
    this.calls.push(name);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  private get(formId: string): MForm {
    const f = this.forms.get(formId);
    if (!f) throw new StudioError('not_found', 'That form was not found.', 404);
    return f;
  }

  private open(f: MForm): Version | undefined {
    return f.versions.find((v) => v.state === 'draft' || v.state === 'in_review');
  }

  private openOrThrow(f: MForm): Version {
    const d = this.open(f);
    if (!d) throw new StudioError('no_draft', 'This form has no draft. Start one first.', 404);
    return d;
  }

  private newVersion(f: MForm, def: FormDefinition, note: string | null, source = 'human'): Version {
    const v: Version = {
      id: id('v'),
      formId: f.id,
      versionNo: f.versions.reduce((m, x) => Math.max(m, x.versionNo), 0) + 1,
      state: source === 'human' ? 'draft' : 'in_review',
      source,
      note,
      rowVersion: 1,
      createdAt: now(),
      updatedAt: now(),
      publishedAt: null,
      savedBy: ME,
      definition: clone(def),
      problems: mockProblems(def),
      editors: [],
    };
    f.versions.push(v);
    return v;
  }

  private bare(v: Version, withDef = false): Version {
    return { ...clone(v), definition: withDef ? clone(v.definition) : null, problems: mockProblems(v.definition!) };
  }

  /** Seed a form (optionally published), for specs and the mocked world. */
  seed(title: string, def: FormDefinition, opts: { publish?: boolean; origin?: FormOrigin; departmentKey?: string | null } = {}): string {
    const f: MForm = { id: id('f'), key: title.toLowerCase().replace(/\W+/g, '-'), title, specialty: def.specialty ?? null, status: 'active', publishedId: null, origin: opts.origin ?? 'local', departmentKey: opts.departmentKey ?? def.specialty ?? null, versions: [] };
    this.forms.set(f.id, f);
    const v = this.newVersion(f, { ...def, title }, null);
    if (opts.publish) {
      v.state = 'published';
      v.publishedAt = now();
      f.publishedId = v.id;
    }
    return f.id;
  }

  async listForms(status: 'active' | 'archived' | 'all' = 'all'): Promise<FormRow[]> {
    await this.tick('listForms');
    return [...this.forms.values()]
      .filter((f) => status === 'all' || f.status === status)
      .map((f) => {
        const p = f.versions.find((v) => v.id === f.publishedId);
        const d = this.open(f);
        return {
          id: f.id,
          key: f.key,
          title: f.title,
          specialty: f.specialty,
          status: f.status,
          origin: f.origin,
          departmentKey: f.departmentKey,
          departmentName: this.depts.find((d) => d.key === f.departmentKey)?.name ?? null,
          catalogKey: f.origin === 'local' ? null : f.key,
          readOnly: f.origin === 'master',
          forkedFromVersionId: null,
          pinned: false,
          newerMaster: false,
          published: p ? { id: p.id, versionNo: p.versionNo, publishedAt: p.publishedAt } : null,
          draft: d ? { id: d.id, versionNo: d.versionNo, state: d.state, source: d.source, updatedAt: d.updatedAt, rowVersion: d.rowVersion } : null,
        };
      });
  }

  async form(formId: string): Promise<FormDetail> {
    await this.tick('form');
    const f = this.get(formId);
    return {
      id: f.id,
      key: f.key,
      title: f.title,
      specialty: f.specialty,
      status: f.status,
      origin: f.origin,
      departmentKey: f.departmentKey,
      readOnly: f.origin === 'master',
      catalogKey: f.origin === 'local' ? null : f.key,
      forkedFromVersionId: null,
      newerMaster: false,
      currentPublishedVersionId: f.publishedId,
      versions: [...f.versions]
        .sort((a, b) => b.versionNo - a.versionNo)
        .map((v) => ({
          id: v.id,
          versionNo: v.versionNo,
          state: v.state,
          source: v.source,
          note: v.note,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
          publishedAt: v.publishedAt,
          createdBy: ME,
          savedBy: v.savedBy,
          publishedBy: v.publishedAt ? ME : null,
        })),
    };
  }

  async version(formId: string, versionId: string): Promise<Version> {
    await this.tick('version');
    const v = this.get(formId).versions.find((x) => x.id === versionId);
    if (!v) throw new StudioError('not_found', 'That version was not found.', 404);
    return this.bare(v, true);
  }

  async createForm(title: string, definition?: FormDefinition): Promise<{ id: string; version: Version }> {
    await this.tick('createForm');
    if (!title.trim()) throw new StudioError('invalid_title', 'Give the form a title (up to 200 characters).', 400);
    const formId = this.seed(title, definition ?? { schemaVersion: 2, title, pages: [], narrative: { sections: [] } });
    const f = this.get(formId);
    return { id: formId, version: this.bare(f.versions[0]) };
  }

  async duplicate(formId: string, title?: string): Promise<{ id: string; version: Version }> {
    await this.tick('duplicate');
    const f = this.get(formId);
    const basis = f.versions.find((v) => v.id === f.publishedId) ?? f.versions[f.versions.length - 1];
    return this.createForm(title || `Copy of ${f.title}`, { ...clone(basis.definition!), title: title || `Copy of ${f.title}` });
  }

  readonly depts: DepartmentRow[] = [
    { key: 'ent', name: 'ENT', sortOrder: 1 },
    { key: 'general', name: 'General medicine', sortOrder: 2 },
  ];

  async departments(): Promise<DepartmentRow[]> {
    await this.tick('departments');
    return clone(this.depts);
  }

  async fork(formId: string): Promise<{ id: string; version: Version }> {
    await this.tick('fork');
    const m = this.get(formId);
    if (m.origin !== 'master') throw new StudioError('not_master', 'Only a master form can be copied this way.', 409);
    const have = [...this.forms.values()].find((x) => x.forkedFrom === m.id);
    if (have) return { id: have.id, version: this.bare(this.open(have) ?? have.versions[have.versions.length - 1]) };
    const basis = m.versions.find((v) => v.id === m.publishedId);
    if (!basis) throw new StudioError('not_published', 'This master form is not published yet.', 409);
    const f: MForm = { id: id('f'), key: m.key, title: m.title, specialty: m.specialty, status: 'active', publishedId: null, origin: 'override', departmentKey: m.departmentKey, forkedFrom: m.id, versions: [] };
    this.forms.set(f.id, f);
    return { id: f.id, version: this.bare(this.newVersion(f, basis.definition!, `Copied from master version ${basis.versionNo}`)) };
  }

  async archive(formId: string, archived: boolean): Promise<void> {
    await this.tick('archive');
    this.get(formId).status = archived ? 'archived' : 'active';
  }

  async startDraft(formId: string): Promise<Version> {
    await this.tick('startDraft');
    const f = this.get(formId);
    if (this.open(f)) throw new StudioError('draft_exists', 'This form already has a draft being edited.', 409);
    const basis = [...f.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
    return this.bare(this.newVersion(f, basis.definition!, `Started from version ${basis.versionNo}`));
  }

  async saveDraft(formId: string, definition: FormDefinition, rowVersion: number): Promise<Version> {
    await this.tick('saveDraft');
    const d = this.openOrThrow(this.get(formId));
    if (d.rowVersion !== rowVersion) throw new DraftConflict(this.bare(d, true), d.savedBy, `${d.savedBy?.name ?? 'Someone else'} saved this form first.`);
    d.definition = clone(definition);
    d.rowVersion++;
    d.updatedAt = now();
    d.savedBy = ME;
    return { ...this.bare(d), editors: clone(this.editors) };
  }

  /** Another person saves (for conflict specs). */
  otherSaves(formId: string, change: (d: FormDefinition) => void, by: Person = { id: 'u-rao', name: 'Dr Rao', email: 'rao@example.com' }): void {
    const d = this.openOrThrow(this.get(formId));
    change(d.definition!);
    d.rowVersion++;
    d.savedBy = by;
  }

  async discardDraft(formId: string): Promise<void> {
    await this.tick('discardDraft');
    const f = this.get(formId);
    const d = this.openOrThrow(f);
    f.versions = f.versions.filter((v) => v !== d);
    if (!f.versions.length) this.forms.delete(formId);
  }

  async publish(formId: string, rowVersion?: number): Promise<Version> {
    await this.tick('publish');
    const f = this.get(formId);
    const d = this.openOrThrow(f);
    if (rowVersion !== undefined && rowVersion !== d.rowVersion) throw new DraftConflict(this.bare(d, true), d.savedBy);
    const problems = mockProblems(d.definition!);
    if (problems.some((p) => p.severity === 'error')) throw new PublishRefused(problems);
    for (const v of f.versions) if (v.state === 'published') v.state = 'retired';
    d.state = 'published';
    d.publishedAt = now();
    d.rowVersion++;
    f.publishedId = d.id;
    f.title = d.definition!.title || f.title;
    return this.bare(d);
  }

  async restore(formId: string, versionId: string): Promise<Version> {
    await this.tick('restore');
    const f = this.get(formId);
    if (this.open(f)) throw new StudioError('draft_exists', 'This form already has a draft being edited.', 409);
    const basis = f.versions.find((v) => v.id === versionId);
    if (!basis) throw new StudioError('not_found', 'That version was not found.', 404);
    return this.bare(this.newVersion(f, basis.definition!, `Restored from version ${basis.versionNo}`));
  }

  async diff(formId: string, from?: string, to?: string): Promise<VersionDiff> {
    await this.tick('diff');
    const f = this.get(formId);
    const sorted = [...f.versions].sort((a, b) => b.versionNo - a.versionNo);
    const a = (from ? f.versions.find((v) => v.id === from) : f.versions.find((v) => v.id === f.publishedId)) ?? sorted[sorted.length - 1];
    const b = (to ? f.versions.find((v) => v.id === to) : this.open(f)) ?? sorted[0];
    const ch = diffDefinitions(a.definition!, b.definition!);
    return {
      from: { id: a.id, versionNo: a.versionNo, state: a.state },
      to: { id: b.id, versionNo: b.versionNo, state: b.state },
      headline: summariseChanges(ch),
      total: ch.length,
      changes: ch.map((c) => {
        const loc = c.fieldKey ? locate(b.definition!, c.fieldKey) ?? locate(a.definition!, c.fieldKey) : null;
        return {
          type: c.kind,
          pageKey: loc?.page.key ?? null,
          pageTitle: c.where,
          fieldKey: c.fieldKey ?? null,
          fieldLabel: loc?.field.label ?? null,
          what: null,
          before: c.before ?? null,
          after: c.after ?? null,
          words: c.text,
        };
      }),
    };
  }

  async livePreview(definition: FormDefinition, answers?: Answers): Promise<LivePreview> {
    await this.tick('livePreview');
    const a = answers ?? sampleAnswers(definition);
    return { sections: mockNarrative(definition, a), warnings: [], problems: mockProblems(definition), answers: answers ? null : a };
  }

  async components(): Promise<ComponentKind[]> {
    await this.tick('components');
    return Object.values(KIND_BUILDS).map((b) => ({
      name: b.kind,
      title: b.name,
      description: b.hint,
      usesOptions: !!b.starterOptions,
      usesChildren: b.kind === 'repeat',
      defaults: {},
      configSchema: { properties: Object.fromEntries(b.config.map((c) => [c.name, c.choices ? { enum: Object.keys(c.choices) } : {}])) },
    }));
  }

  async templates(kind?: TemplateKind): Promise<TemplateRow[]> {
    await this.tick('templates');
    return [...this.tpl.values()].filter((t) => !kind || t.kind === kind).map(({ body: _b, ...t }) => t);
  }

  async saveTemplate(kind: TemplateKind, title: string, body: unknown, category?: string): Promise<TemplateRow> {
    await this.tick('saveTemplate');
    const t = { id: id('t'), kind, title, category: category ?? null, description: null, rowVersion: 1, body: clone(body) };
    this.tpl.set(t.id, t);
    const { body: _b, ...row } = t;
    return row;
  }

  async deleteTemplate(tid: string): Promise<void> {
    await this.tick('deleteTemplate');
    this.tpl.delete(tid);
  }

  async expandTemplate(tid: string): Promise<{ kind: TemplateKind; body: unknown }> {
    await this.tick('expandTemplate');
    const t = this.tpl.get(tid);
    if (!t) throw new StudioError('not_found', 'That template was not found.', 404);
    return { kind: t.kind, body: clone(t.body) };
  }

  async importLegacy(legacy: unknown, opts: { dryRun: boolean; title?: string }): Promise<ImportResult> {
    await this.tick('importLegacy');
    const l = legacy as { displayName?: string; name?: string };
    if (!legacy || typeof legacy !== 'object') throw new StudioError('import_failed', "That file isn't a form.", 400);
    const title = opts.title || l.displayName || l.name || 'Imported form';
    const definition: FormDefinition = { schemaVersion: 2, title, pages: [{ key: 'page1', title: 'Page 1', fields: [] }], narrative: { sections: [] } };
    const report = {
      summary: `Imported '${title}': 1 page and 0 fields. Nothing needs fixing.`,
      canPublish: true,
      counts: { pages: 1, fields: 0, unsupported: 0, attention: 0, problems: 0 },
      items: [],
    };
    if (opts.dryRun) return { saved: false, formId: null, versionId: null, definition, report };
    const r = await this.createForm(title, definition);
    return { saved: true, formId: r.id, versionId: r.version.id, definition, report };
  }

  /** Cortex import: a job that walks queued → reading → building → checking → done, then a draft with one "Check this". */
  private readonly jobs = new Map<string, { polls: number; input: DraftFromSheetInput; formId?: string }>();

  async draftFromSheet(input: DraftFromSheetInput): Promise<{ jobId: string }> {
    await this.tick('draftFromSheet');
    if (!input.files.length) throw new StudioError('no_files', 'Add at least one page.', 400);
    const jobId = id('job');
    this.jobs.set(jobId, { polls: 0, input });
    return { jobId };
  }

  async draftJob(jobId: string): Promise<DraftJob> {
    await this.tick('draftJob');
    const j = this.jobs.get(jobId);
    if (!j) throw new StudioError('not_found', 'That job has expired.', 404);
    const steps: DraftJob['status'][] = ['queued', 'reading', 'building', 'checking'];
    if (j.polls < steps.length) return { status: steps[j.polls++] };
    if (!j.formId) {
      const title = j.input.title?.trim() || 'Cortex draft';
      let def = addPage(emptyDefinition(title), 'History').def;
      const q = addField(def, { pageKey: 'history' }, 'text');
      def = updateField(setLabel(q.def, q.key, 'Complaint'), q.key, (f) => (f.config = { ...f.config, checkNote: 'The handwriting here was hard to read.' }));
      j.formId = this.seed(title, def, { departmentKey: j.input.departmentKey });
    }
    return { status: 'done', formId: j.formId, checkCount: 1 };
  }

  async presence(): Promise<Editor[]> {
    await this.tick('presence');
    return clone(this.editors);
  }

  async leave(): Promise<void> {
    await this.tick('leave');
  }
}
