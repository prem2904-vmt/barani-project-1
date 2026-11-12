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

/** Where a case sheet comes from: the platform's master, this lab's copy of a master (fork), or the lab's own. */
export type FormOrigin = 'master' | 'override' | 'local';

/**
 * An IPD department forms are filed under. Masters come from Prefrontal (`own` false, read-only); the lab adds and
 * manages its own (`own` true). `isActive` false = hidden from doctors (only listed with `includeInactive`).
 */
export interface DepartmentRow {
  key: string;
  name: string;
  sortOrder: number;
  isActive?: boolean;
  /** True when this lab owns (and can edit) the row. */
  own?: boolean;
}

/** What a lab may change on one of its own departments. */
export interface DepartmentInput {
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
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
  /** The department's display name (the API sends it on list rows), or null. */
  departmentName: string | null;
  /** The catalogue key a master and its copies share, or null for a lab's own form. */
  catalogKey: string | null;
  /** A master seen from a lab: read-only until Edit makes the lab's copy (fork). */
  readOnly: boolean;
  /** The master version this copy was made from. */
  forkedFromVersionId: string | null;
  /** The signed-in user pinned it. */
  pinned: boolean;
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
  /** "History · Pain" or "The case sheet". */
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
  departmentKey: string | null;
  readOnly: boolean;
  catalogKey: string | null;
  forkedFromVersionId: string | null;
  newerMaster: boolean;
  currentPublishedVersionId: string | null;
  versions: VersionRow[];
}

/** What a key rename touched (PATCH forms/{id} {key}): the counts the confirm and the result sentence name. */
export interface KeyRename {
  from: string;
  to: string;
  labCopies: number;
  offers: number;
  proposals: number;
}

/** The answer of PATCH forms/{id}: the new key, and what following it took along (null when the key did not change). */
export interface FormPatched {
  id: string;
  key: string;
  title: string;
  departmentKey: string | null;
  rename: KeyRename | null;
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
    message = 'Someone else saved this case sheet first.',
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

/* ---------------- Cortex: a case sheet from a paper sheet (beta) ---------------- */

export type DraftJobStatus = 'queued' | 'reading' | 'building' | 'checking' | 'done' | 'failed';

/** One case sheet a "case sheet from paper" job made (a long booklet of several proformas makes several). */
export interface DraftMade {
  formId: string;
  title: string;
  departmentKey: string;
  departmentName: string;
  /** Where it came from in the upload (printed pages, from 1). */
  fromPage: number;
  toPage: number;
  checkCount: number;
  /** Plain words: pages of this case sheet Cortex could not read. */
  warnings: string[];
}

/** While the server reads: its own words ("Found 4 case sheets. Reading part 3 of 9.") and parts done of parts planned. */
export interface DraftProgress {
  text: string;
  done: number;
  total: number;
  sheets: number;
}

/** What the server says about one "case sheet from paper" job (GET draft-jobs/{jobId}). */
export interface DraftJob {
  status: DraftJobStatus;
  /** Done: the FIRST case sheet (what a one-sheet answer always had). */
  formId?: string;
  checkCount?: number;
  /** Done: every case sheet made, in page order (an older server sends none: use formId). */
  drafts?: DraftMade[];
  /** Done: the job's own notes (a cover page left out, a case sheet that could not be made). */
  warnings?: string[];
  progress?: DraftProgress;
  /** When failed: unreadable | patient_data | invalid_result | timeout | bad_reply | call_failed | cortex_unavailable | cap_reached | feature_off | model_error. */
  code?: string;
  message?: string;
}

export interface DraftFromSheetInput {
  files: File[];
  departmentKey: string;
  title?: string;
}
