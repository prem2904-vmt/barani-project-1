/**
 * Cortex: a case sheet from a paper sheet (dev beta). The pure parts, with no Angular and no DOM: what the dialog
 * accepts, the plain words for every refusal and failure, the progress steps, and the "Check this" markers
 * (`config.checkNote`) on a case sheet definition.
 */
import { FieldDef, FormDefinition, allFields, updateField } from '@prefrontal/forms-engine';
import { DraftJob, DraftJobStatus, DraftMade } from '../data/studio-models';

export const MAX_FILES = 8;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const ACCEPT = 'image/*,application/pdf';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** The file's type, from the browser, else from its name (some cameras and PDFs arrive with no type). */
export function fileType(f: { name: string; type: string }): string {
  if (f.type) return f.type.toLowerCase();
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  return ALLOWED_EXT[ext] ?? '';
}

export function isAllowedType(f: { name: string; type: string }): boolean {
  return ALLOWED_TYPES.includes(fileType(f));
}

/** Why these pages cannot be sent (plain words), or '' when they are fine. */
export function pagesProblem(files: readonly { name: string; type: string; size: number }[]): string {
  if (!files.length) return 'Add at least one page.';
  if (files.length > MAX_FILES) return `Use up to ${MAX_FILES} pages. Remove ${files.length - MAX_FILES} to continue.`;
  const bad = files.find((f) => !isAllowedType(f));
  if (bad) return `“${bad.name}” isn't a photo or a PDF. Use JPEG, PNG, WebP or PDF.`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_BYTES) return 'The pages are over 20 MB together. Remove one or use smaller photos.';
  return '';
}

/**
 * Add picked files to the list: files that don't fit the type rule are kept out and named, the rest are appended
 * (a file already in the list is not added twice). Count and size are checked by {@link pagesProblem} on the result.
 */
export function addPages<T extends { name: string; type: string; size: number; lastModified?: number }>(
  current: readonly T[],
  picked: readonly T[],
): { files: T[]; rejected: string[] } {
  const files = [...current];
  const rejected: string[] = [];
  for (const f of picked) {
    if (!isAllowedType(f)) {
      rejected.push(f.name);
      continue;
    }
    if (files.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) continue;
    files.push(f);
  }
  return { files, rejected };
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/* ---------------- plain words for refusals and failures ---------------- */

const START_REFUSALS: Record<string, string> = {
  no_files: 'Add at least one page.',
  too_many_files: `Use up to ${MAX_FILES} pages.`,
  too_large: 'The pages are over 20 MB together. Remove one or use smaller photos.',
  bad_type: 'Use JPEG, PNG, WebP or PDF pages.',
  unknown_department: 'Pick a department from the list.',
  feature_off: "Cortex isn't switched on for your lab.",
  cortex_unavailable: "Cortex isn't set up yet.",
  cap_reached: "This month's limit for Cortex is reached. Ask your admin.",
  too_long: 'This file has more pages than Cortex reads at once (60). Upload it in parts.',
};
export const NOT_AVAILABLE = "Starting a case sheet from a paper sheet isn't available here yet.";

/** Words for a refused start (POST). 404 / 424 with no code mean the server doesn't offer it. */
export function startRefusal(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (typeof code === 'string' && START_REFUSALS[code]) return START_REFUSALS[code];
  const status = (e as { status?: number })?.status;
  if (status === 404 || status === 424) return NOT_AVAILABLE;
  if (status === 0) return "Can't reach the server right now. Your pages are kept on this screen.";
  return "Couldn't start reading the sheet. Please try again.";
}

const FAILURES: Record<string, string> = {
  unreadable: "Cortex couldn't read the sheet. Try a clearer photo.",
  patient_data: "This sheet has a patient's details. Upload a blank one. Nothing was kept.",
  invalid_result: "Cortex couldn't turn this sheet into a case sheet that works. Try a clearer photo.",
  timeout: 'Cortex took too long to read this sheet, even in parts. Try again in a few minutes, or upload fewer pages at a time.',
  bad_reply: "Cortex's answer for this sheet came back incomplete, even in parts. Try again; if it happens again, upload fewer pages at a time.",
  call_failed: "Cortex couldn't be reached just now. Try again in a moment.",
  cortex_unavailable: "Cortex isn't set up yet. Ask your admin.",
  cap_reached: "This month's limit for Cortex is reached. Ask your admin.",
  feature_off: "Cortex isn't switched on for your lab.",
  model_error: 'Something went wrong on our side while reading this sheet. Nothing was kept. Try again, and tell support if it happens again.',
};

/** Words for a job that ended `failed`. */
export function jobFailure(code: string | undefined): string {
  return (code && FAILURES[code]) || 'Cortex could not finish this sheet. Please try again.';
}

/* ---------------- what a finished job made ---------------- */

/** Every case sheet a done job made, in page order. An older server sends only `formId`: that is one case sheet. */
export function madeDrafts(job: Pick<DraftJob, 'formId' | 'checkCount' | 'drafts'>, name = ''): DraftMade[] {
  if (job.drafts?.length) return job.drafts;
  if (!job.formId) return [];
  return [{ formId: job.formId, title: name, departmentKey: '', departmentName: '', fromPage: 1, toPage: 1, checkCount: job.checkCount ?? 0, warnings: [] }];
}

/** "4 case sheets made: Gastrointestinal system, CNS, Respiratory system, CVS" (or "1 case sheet made"). */
export function madeSummary(drafts: readonly DraftMade[]): string {
  const n = drafts.length;
  const head = `${n} case sheet${n === 1 ? '' : 's'} made`;
  const names = drafts.map((d) => d.title.trim()).filter(Boolean);
  return names.length && n > 1 ? `${head}: ${names.join(', ')}` : head;
}

/** "Pages 10–20" / "Page 4". */
export function pagesLabel(from: number, to: number): string {
  return from === to ? `Page ${from}` : `Pages ${from}–${to}`;
}

/** A finished job opens straight in the editor only when it made ONE case sheet with nothing to warn about; else the list shows. */
export function opensStraightAway(drafts: readonly DraftMade[], warnings: readonly string[] | undefined): boolean {
  return drafts.length === 1 && !drafts[0].warnings.length && !warnings?.length;
}

/* ---------------- progress ---------------- */

export const STEPS = ['Reading the pages', 'Building the questions', 'Writing what it says', 'Checking'] as const;
export type StepState = 'pending' | 'active' | 'done';

/**
 * The four steps ticked off for a job status. The server reports three working stages, so "building" covers both
 * building the questions and writing what they say.
 */
export function stepStates(status: DraftJobStatus): StepState[] {
  switch (status) {
    case 'done':
      return ['done', 'done', 'done', 'done'];
    case 'checking':
      return ['done', 'done', 'done', 'active'];
    case 'building':
      return ['done', 'active', 'active', 'pending'];
    case 'reading':
    case 'queued':
      return ['active', 'pending', 'pending', 'pending'];
    default:
      return ['pending', 'pending', 'pending', 'pending'];
  }
}

/* ---------------- "Check this" markers ---------------- */

export function checkNoteOf(f: Pick<FieldDef, 'config'>): string {
  const n = f.config?.['checkNote'];
  return typeof n === 'string' ? n.trim() : '';
}

/** How many questions Cortex marked for a look (sub-fields and repeat children included). */
export function countChecks(def: FormDefinition | null | undefined): number {
  return def ? allFields(def).filter((f) => checkNoteOf(f)).length : 0;
}

/** This question without its marker (Looks right). */
export function clearCheck(def: FormDefinition, key: string): FormDefinition {
  return updateField(def, key, (f) => {
    if (!f.config) return;
    delete f.config['checkNote'];
    if (!Object.keys(f.config).length) delete f.config;
  });
}

/** A question's own content (without its follow-ups and children, which are other questions) and without its marker. */
function signature(f: FieldDef): string {
  const { config, options, children, ...rest } = f;
  const c = config ? { ...config } : undefined;
  if (c) delete c['checkNote'];
  return JSON.stringify({
    ...rest,
    config: c && Object.keys(c).length ? c : undefined,
    options: options?.map(({ subFields, ...o }) => ({ ...o, n: subFields?.length ?? 0 })),
    children: children?.length ?? 0,
  });
}

/** The question's content per marked key, taken before an edit. */
export function markedSignatures(def: FormDefinition | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (def) for (const f of allFields(def)) if (checkNoteOf(f)) m.set(f.key, signature(f));
  return m;
}

/** After an edit: a marked question whose content changed loses its marker ("any edit clears it"). */
export function dropEditedChecks(before: Map<string, string>, next: FormDefinition): FormDefinition {
  let out = next;
  if (!before.size) return out;
  for (const f of allFields(next)) {
    const was = before.get(f.key);
    if (was !== undefined && checkNoteOf(f) && signature(f) !== was) out = clearCheck(out, f.key);
  }
  return out;
}
