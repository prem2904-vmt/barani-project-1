import { Injectable, inject } from '@angular/core';
import { Answers, FormDefinition } from '@prefrontal/forms-engine';
import {
  ComponentKind,
  DepartmentInput,
  DepartmentRow,
  DraftFromSheetInput,
  DraftJob,
  Editor,
  FormDetail,
  FormRow,
  ImportResult,
  LivePreview,
  Page,
  TemplateKind,
  TemplateRow,
  Version,
  VersionDiff,
} from './studio-models';
import { HttpStudioApi } from './http-studio-api';

/**
 * Everything Studio asks of the API, typed. Screens inject `StudioApi`; the
 * app provides `HttpStudioApi`, unit tests and the mocked E2E world provide
 * `MockStudioApi` (same rules: one open draft, row versions → 409 with the
 * other person's copy, publish refused with problems per field).
 *
 * Throws: `DraftConflict` (someone saved first), `PublishRefused` (fix
 * these first), `StudioError` (any other refusal, in plain words) or an
 * `HttpErrorResponse` (status 0 = offline).
 */
@Injectable({ providedIn: 'root', useFactory: () => inject(HttpStudioApi) })
export abstract class StudioApi {
  // forms
  abstract listForms(status?: 'active' | 'archived' | 'all'): Promise<FormRow[]>;
  abstract form(formId: string): Promise<FormDetail>;
  abstract version(formId: string, versionId: string): Promise<Version>;
  abstract createForm(title: string, definition?: FormDefinition, specialty?: string): Promise<{ id: string; version: Version }>;
  abstract duplicate(formId: string, title?: string): Promise<{ id: string; version: Version }>;
  /** The departments forms are filed under: Prefrontal's masters, then the lab's own. `includeInactive` (managers only) adds hidden ones. */
  abstract departments(opts?: { includeInactive?: boolean }): Promise<DepartmentRow[]>;
  /** Add a department of the lab's own (the key is made from the name). StudioError codes: invalid_name, name_taken, key_taken. */
  abstract createDepartment(input: DepartmentInput & { name: string; key?: string }): Promise<DepartmentRow>;
  /** Rename / reorder / hide one of the lab's own departments. StudioError codes: master_department, not_found. */
  abstract updateDepartment(key: string, patch: DepartmentInput): Promise<DepartmentRow>;
  /** Remove one of the lab's own departments. StudioError codes: department_in_use, master_department. */
  abstract removeDepartment(key: string): Promise<void>;
  /** "Edit" on a master form: this lab's own copy (same catalogue key) with an open draft. Idempotent per form. */
  abstract fork(formId: string): Promise<{ id: string; version: Version }>;
  abstract archive(formId: string, archived: boolean): Promise<void>;

  // the one open draft
  abstract startDraft(formId: string): Promise<Version>;
  abstract saveDraft(formId: string, definition: FormDefinition, rowVersion: number): Promise<Version>;
  abstract discardDraft(formId: string): Promise<void>;
  abstract publish(formId: string, rowVersion?: number, note?: string): Promise<Version>;
  abstract restore(formId: string, versionId: string): Promise<Version>;

  // history
  abstract diff(formId: string, from?: string, to?: string): Promise<VersionDiff>;

  // live narrative (unsaved definition + sample answers)
  abstract livePreview(definition: FormDefinition, answers?: Answers): Promise<LivePreview>;
  abstract components(): Promise<ComponentKind[]>;

  // templates (server-side, shared)
  abstract templates(kind?: TemplateKind): Promise<TemplateRow[]>;
  abstract saveTemplate(kind: TemplateKind, title: string, body: unknown, category?: string): Promise<TemplateRow>;
  abstract deleteTemplate(id: string): Promise<void>;
  /** The template's page / field with keys that don't clash with the form it goes into. */
  abstract expandTemplate(id: string, usedFieldKeys: string[], usedPageKeys: string[]): Promise<{ kind: TemplateKind; body: unknown }>;

  // legacy import
  abstract importLegacy(legacy: unknown, opts: { dryRun: boolean; title?: string }): Promise<ImportResult>;

  // Cortex: a case sheet from a paper sheet (dev beta)
  /** Upload the pages; the server starts a job (202 `{ jobId }`). Refusals carry a `code` (StudioError). */
  abstract draftFromSheet(input: DraftFromSheetInput): Promise<{ jobId: string }>;
  abstract draftJob(jobId: string): Promise<DraftJob>;

  // presence ("Dr X is also editing")
  abstract presence(formId: string): Promise<Editor[]>;
  abstract leave(formId: string): Promise<void>;
}
