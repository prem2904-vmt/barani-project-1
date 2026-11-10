import { Answers, FormDefinition } from '@prefrontal/forms-engine';
import {
  CaseLink,
  CaseNarrative,
  CaseSheetDepartment,
  CaseSave,
  CaseSheet,
  CaseState,
  CaseSummary,
  FormSummary,
  Page,
  PatientBlock,
  PdfLink,
  PracticeSettings,
  PublishedForm,
  SaveAck,
  Suggestion,
} from './case-models';

/**
 * Everything the doctor's screens ask of the API, typed. Screens inject
 * `CasesApi`; the app provides `HttpCasesApi`, unit tests and the mocked E2E
 * world provide `MockCasesApi` (same rules: row versions, 409, 422).
 *
 * Errors: a write that lost a race throws `CaseConflict`; a write to a
 * finished sheet throws `CaseFinal`; a refused finish throws
 * `FinishRefused`; dictation that is not set up throws `VoiceUnavailable`;
 * anything else is an `HttpErrorResponse` (status 0 = offline).
 */
export abstract class CasesApi {
  abstract listForms(): Promise<FormSummary[]>;
  /** The master-owned departments, in their order (plan §3.3). Empty when none are set up. */
  abstract listDepartments(): Promise<CaseSheetDepartment[]>;
  /** Pin / unpin a form at the top of Forms. */
  abstract pinForm(formId: string, pinned: boolean): Promise<void>;

  /** My suggestion chips for one text field of one form (learned when I finish sheets). */
  abstract suggestions(formId: string, field: string, q?: string, limit?: number): Promise<Suggestion[]>;
  abstract deleteSuggestion(id: string): Promise<void>;
  abstract publishedForm(formId: string): Promise<PublishedForm>;
  /** The definition a sheet is pinned to (falls back to the live version when the pinned one is not readable). */
  abstract formVersion(formId: string, versionId: string): Promise<FormDefinition>;

  abstract listCases(q: {
    state?: CaseState;
    search?: string;
    /** One patient's sheets (lab: the patient profile). */
    patientId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Page<CaseSummary>>;
  /** Start a sheet (pinned to the published version). In a lab `link` ties it to the LMS patient (plan §3.5 / §7). */
  abstract createCase(formId: string, patient?: Partial<PatientBlock>, link?: CaseLink): Promise<CaseSheet>;
  abstract getCase(id: string): Promise<CaseSheet>;
  abstract saveCase(id: string, body: CaseSave): Promise<SaveAck>;
  abstract narrative(id: string): Promise<CaseNarrative>;
  abstract editSection(id: string, sectionId: string, text: string, rowVersion: number): Promise<SaveAck>;
  abstract clearSection(id: string, sectionId: string, rowVersion: number): Promise<SaveAck>;
  /** Rename a section ('' = back to the form's title). */
  abstract renameSection(id: string, sectionId: string, title: string, rowVersion: number): Promise<SaveAck>;
  /** Add a section of the doctor's own; resolves with the new section's id. */
  abstract addOwnSection(
    id: string,
    section: { title: string; text: string },
    rowVersion: number,
  ): Promise<SaveAck & { sectionId: string }>;
  abstract finishCase(id: string, rowVersion: number): Promise<CaseSheet>;
  /** A final sheet → a new draft with the same answers (same form version). */
  abstract amendCase(id: string): Promise<CaseSheet>;
  abstract deleteCase(id: string): Promise<void>;
  /** The PDF bytes (a draft is rendered on the spot, a final one is the stored file). */
  abstract casePdf(id: string): Promise<Blob>;
  /** A short-lived link to a final sheet's PDF (for download / share without the sign-in header). */
  abstract pdfLink(id: string): Promise<PdfLink>;

  /** Narrative from answers that are not saved yet (the API is the truth for the words). */
  abstract narrativePreview(formVersionId: string, answers: Answers, visitedPages?: string[]): Promise<CaseNarrative>;

  abstract getPractice(): Promise<PracticeSettings>;
  abstract savePractice(s: PracticeSettings): Promise<PracticeSettings>;
  abstract uploadPracticeImage(kind: 'logo' | 'signature', file: Blob): Promise<PracticeSettings>;
  abstract removePracticeImage(kind: 'logo' | 'signature'): Promise<PracticeSettings>;

  abstract transcribe(
    audio: Blob,
    context: { label: string; specialty?: string; durationMs?: number },
  ): Promise<string>;
}
