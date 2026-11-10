import { Answers, FormDefinition, NarrativeTable } from '@prefrontal/forms-engine';

/**
 * The shapes the case-sheet screens use. They mirror the API
 * (prefrontal-mw docs/CASESHEETS.md Part 2 = Prepare's `CaseSheetsController`, `PracticeSettingsController`,
 * `VoiceController`, `FormsController` under `/api/casesheets/*`); `HttpCasesApi` adapts the wire
 * format to these so screens never see it. Ported from prefrontal-prepare-ui `core/cases/case-models.ts` @ bca8282;
 * Prefrontal additions: the master-owned department (`departmentKey`, {@link CaseSheetDepartment}) and the sheet's
 * link to an LMS patient (`patientId`, {@link CaseLink}; plan §3.5 / §7).
 */

export interface FormSummary {
  id: string;
  key: string;
  title: string;
  /** The department's display name (the master department's name; Prepare's free-text `specialty` as a fallback). */
  specialty: string | null;
  /** The master-owned department key (plan §3.3); null = "General". */
  departmentKey: string | null;
  publishedVersionId: string | null;
  versionNo: number | null;
  publishedAt: string | null;
  /** The doctor pinned this form to the top of Forms (legacy favourite specialties). */
  pinned: boolean;
}

/** A master-owned department (plan §3.3: `casesheet_departments`, authored in the admin console; labs can't add one). */
export interface CaseSheetDepartment {
  key: string;
  name: string;
  sortOrder: number;
}

/**
 * What a new sheet is started FROM (plan §7, the admit hook): in a lab, the LMS patient (phase 1: `contextKind`
 * `patient`); later an OPD visit / IPD admission. The public site sends none (the patient block only).
 */
export interface CaseLink {
  patientId: string;
  contextKind?: 'patient' | 'opd_visit' | 'ipd_admission';
  contextId?: string | null;
}

export interface PublishedForm {
  formId: string;
  versionId: string;
  versionNo: number;
  definition: FormDefinition;
}

export type CaseState = 'draft' | 'final';

export interface PatientBlock {
  name: string | null;
  age: string | null;
  sex: string | null;
  ref: string | null;
}

export interface CaseSummary {
  id: string;
  state: CaseState;
  formId: string;
  formTitle: string;
  formVersionId: string;
  /** The LMS patient the sheet belongs to (lab); null on the public site. */
  patientId: string | null;
  patientName: string | null;
  patientAge: string | null;
  patientSex: string | null;
  /** Key of the page the doctor last reached (drafts). */
  lastPage: string | null;
  updatedAt: string;
  finalisedAt: string | null;
  hasPdf: boolean;
  rowVersion: number;
  amendedFromId: string | null;
  /** `human`, or `assistant:<client>` for a draft an assistant prepared through the AI connector. */
  source: string;
}

export interface CaseSheet {
  id: string;
  state: CaseState;
  formId: string;
  formTitle: string;
  formVersionId: string;
  formVersionNo: number;
  /** The LMS patient the sheet belongs to (lab); null on the public site. */
  patientId: string | null;
  patient: PatientBlock;
  answers: Answers;
  visitedPages: string[];
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  finalisedAt: string | null;
  amendedFromId: string | null;
  hasPdf: boolean;
  source: string;
}

/**
 * One autosave (PATCH, merge): `answers` sets keys, `remove` drops keys,
 * `patient` changes only the properties present, `visitedPages` replaces
 * the list (page KEYS, not repetition ids). `requestId` makes a retry of a
 * save whose answer was lost safe.
 */
export interface CaseSave {
  rowVersion: number;
  requestId: string;
  answers?: Answers;
  remove?: string[];
  patient?: Partial<PatientBlock>;
  visitedPages?: string[];
}

export interface SaveAck {
  id: string;
  state: CaseState;
  rowVersion: number;
  updatedAt: string;
}

/** One section of the narrative: generated text, the doctor's edit (if any) and whether the answers changed since the edit. */
export interface NarrativeSection {
  id: string;
  key: string;
  title: string;
  order: number;
  generated: string;
  edited: string | null;
  /** The doctor edited this section and the answers changed since: "keep your text or take the new one?". */
  stale: boolean;
  /** What prints: the edit, else the generated text. */
  content: string;
  /** A section the doctor added (legacy "additional sections" / voice notes): no generated text, removable. */
  own: boolean;
  /** The form's title when the doctor renamed the section (null = not renamed). */
  formTitle: string | null;
  /** Grid tables printed under this section's words (Phase 5); kept when the doctor edits the words. */
  tables?: NarrativeTable[];
}

/** One of the doctor's own wordings for a text field (legacy user_suggestions), most used first. */
export interface Suggestion {
  id: string;
  text: string;
  uses: number;
}

export interface CaseNarrative {
  state: CaseState;
  rowVersion: number;
  frozen: boolean;
  patientName: string;
  age: string | null;
  sex: string | null;
  sections: NarrativeSection[];
  /** Tables whose section wrote no words, each with the order of the section it belongs to (API "Tables in responses"). */
  tables?: NarrativeTable[];
  warnings: string[];
}

export interface MissingAnswer {
  page: string;
  pageTitle: string;
  field: string;
  label: string;
}

export interface PdfLink {
  url: string;
  expiresAt: string;
}

export interface PracticeImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface PracticeSettings {
  practiceName: string;
  doctorName: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  website: string;
  /** Print the header and signature on case-sheet PDFs. */
  enabled: boolean;
  logo: PracticeImage | null;
  signature: PracticeImage | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A write refused because another device saved first (HTTP 409 version_conflict). Carries the server's copy. */
export class CaseConflict extends Error {
  constructor(readonly current: CaseSheet | null) {
    super('This case sheet was changed on another device.');
  }
}

/** The sheet is finished (409 sheet_final): read-only; Amend starts a new draft. */
export class CaseFinal extends Error {
  constructor() {
    super('This case sheet is finished.');
  }
}

/** Finish refused (422 incomplete): what is missing, page by page. */
export class FinishRefused extends Error {
  constructor(readonly missing: MissingAnswer[]) {
    super('Some required answers are missing.');
  }
}

/** Voice typing is not switched on (501) — hide the mics. */
export class VoiceUnavailable extends Error {
  constructor() {
    super('Voice typing is not switched on yet.');
  }
}
