import { Answers, FormDefinition, NarrativeTable } from '@prefrontal/forms-engine';

/**
 * Studio's typed view of the API (prefrontal-prepare-mw FormsController,
 * StudioController, TemplatesController, PeopleController — Phase 3).
 * Screens use these shapes only; `HttpStudioApi` maps the wire into them.
 */

export type VersionState = 'draft' | 'in_review' | 'published' | 'retired';

export interface Person {
  id: string;
  name: string | null;
  email: string;
}

/** Where a form comes from: the platform's master, this lab's copy of a master (fork), or the lab's own. */
export type FormOrigin = 'master' | 'override' | 'local';

/** A department (master-only list; labs cannot create departments). */
export interface DepartmentRow {
  key: string;
  name: string;
  sortOrder: number;
}

export interface FormRow {
  id: string;
  key: string;
  title: string;
  specialty: string | null;
  status: 'active' | 'archived';
  /** master = read-only here (Edit makes this lab's copy); override = this lab's copy of a master; local = this lab's own. */
  origin: FormOrigin;
  /** The department it is filed under (a master department key), or null (shown under "Other"). */
  departmentKey: string | null;
  /** A fork whose master has a newer published version. */
  newerMaster: boolean;
  published: { id: string; versionNo: number; publishedAt: string | null } | null;
  draft: { id: string; versionNo: number; state: VersionState; source: string; updatedAt: string; rowVersion: number } | null;
}

/** A problem in plain words, placed on a page and a field (ProblemExplainer). */
export interface Problem {
  severity: 'error' | 'warning';
  path: string;
  pageKey: string | null;
  pageTitle: string | null;
  fieldKey: string | null;
  fieldLabel: string | null;
  /** "History · Pain" or "The form". */
  where: string;
  message: string;
  summary: string;
}

export interface Editor {
  userId: string;
  name: string;
  seenAt: string;
}

export interface Version {
  id: string;
  formId: string;
  versionNo: number;
  state: VersionState;
  source: string;
  note: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  savedBy: Person | null;
  definition: FormDefinition | null;
  problems: Problem[];
  editors: Editor[];
}

export interface VersionRow {
  id: string;
  versionNo: number;
  state: VersionState;
  source: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  createdBy: Person | null;
  savedBy: Person | null;
  publishedBy: Person | null;
}

export interface FormDetail {
  id: string;
  key: string;
  title: string;
  specialty: string | null;
  status: 'active' | 'archived';
  origin: FormOrigin;
  currentPublishedVersionId: string | null;
  versions: VersionRow[];
}

export interface DiffChange {
  /** added | removed | changed | moved (+ the API's finer types). */
  type: string;
  pageKey: string | null;
  pageTitle: string | null;
  fieldKey: string | null;
  fieldLabel: string | null;
  what: string | null;
  before: string | null;
  after: string | null;
  /** The change as one sentence. */
  words: string;
}

export interface VersionDiff {
  from: { id: string; versionNo: number; state: VersionState };
  to: { id: string; versionNo: number; state: VersionState };
  headline: string;
  total: number;
  changes: DiffChange[];
}

export interface PreviewSection {
  key: string;
  title: string;
  order: number;
  content: string;
  /** The fields that wrote this paragraph (tap → jump to the field). */
  fieldKeys: string[];
  /** Grid tables under this paragraph (Phase 5). */
  tables?: NarrativeTable[];
}

export interface LivePreview {
  sections: PreviewSection[];
  /** Tables whose paragraph wrote no words, with that paragraph's order. */
  tables?: NarrativeTable[];
  warnings: string[];
  problems: Problem[];
  /** The sample answers the API made up (when none were sent). */
  answers: Answers | null;
}

export interface ComponentKind {
  name: string;
  title: string;
  description: string;
  usesOptions: boolean;
  usesChildren: boolean;
  defaults: Record<string, unknown>;
  configSchema: { properties?: Record<string, { enum?: unknown[]; type?: string | string[]; minimum?: number; maximum?: number }> };
}

export type TemplateKind = 'page' | 'field';

export interface TemplateRow {
  id: string;
  kind: TemplateKind;
  title: string;
  category: string | null;
  description: string | null;
  rowVersion: number;
}

export interface ImportItem {
  level: 'problem' | 'attention' | 'info';
  pageKey: string | null;
  pageTitle: string | null;
  fieldKey: string | null;
  fieldLabel: string | null;
  message: string;
}

export interface ImportReport {
  summary: string;
  canPublish: boolean;
  counts: { pages: number; fields: number; unsupported: number; attention: number; problems: number };
  items: ImportItem[];
}

export interface ImportResult {
  saved: boolean;
  formId: string | null;
  versionId: string | null;
  definition: FormDefinition;
  report: ImportReport;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/* ---------------- errors the screens switch on ---------------- */

/** Someone saved first. Their copy is attached; nothing of ours was written. */
export class DraftConflict extends Error {
  constructor(
    readonly current: Version,
    readonly savedBy: Person | null,
    message = 'Someone else saved this form first.',
  ) {
    super(message);
  }
}

/** Publish refused: these must be fixed first (each names its page and field). */
export class PublishRefused extends Error {
  constructor(
    readonly problems: Problem[],
    message = 'Fix these before publishing.',
  ) {
    super(message);
  }
}

/** Any other refusal, already in plain words from the API. */
export class StudioError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Plain words for anything a Studio call throws. */
export function plainError(e: unknown, fallback = "Couldn't do that just now. Please try again."): string {
  if (e instanceof StudioError || e instanceof PublishRefused || e instanceof DraftConflict) return e.message;
  const status = (e as { status?: number })?.status;
  if (status === 0) return "Can't reach the server right now. Your changes are kept on this screen.";
  return fallback;
}
