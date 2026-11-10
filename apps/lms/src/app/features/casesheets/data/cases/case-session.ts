import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Answers, FormDefinition, allFields, patientLabelOf, valuesEqual } from '@prefrontal/forms-engine';
import { CASE_CACHE, CaseCache } from './case-cache';
import { CaseConflict, CaseFinal, CaseNarrative, CaseSave, CaseSheet, PatientBlock, SaveAck } from './case-models';
import { CasesApi } from './cases-api';

export type SaveState = 'saved' | 'pending' | 'saving' | 'offline' | 'error' | 'conflict' | 'final';
export type NarrativeState = 'idle' | 'loading' | 'offline' | 'error';

/** Timing seams (tests use tiny values with fake timers). */
export interface SessionTiming {
  /** Quiet time after the last change before a save goes out (plan §6: 800 ms). */
  debounceMs: number;
  /** Quiet time before the narrative is fetched again. */
  narrativeDebounceMs: number;
  /** Wait before retry number `attempt` (0-based). */
  backoff(attempt: number): number;
}

export const SESSION_TIMING = new InjectionToken<SessionTiming>('SESSION_TIMING', {
  providedIn: 'root',
  factory: () => ({
    debounceMs: 800,
    narrativeDebounceMs: 400,
    backoff: (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt),
  }),
});

/** Plain words for the band's save cue. */
export const SAVE_STATE_TEXT: Record<SaveState, string> = {
  saved: 'Saved',
  pending: 'Saving…',
  saving: 'Saving…',
  offline: 'Offline — saved on this tablet',
  error: "Can't reach Prefrontal — saved on this tablet",
  conflict: 'Changed on another device',
  final: 'Finished',
};

type Job =
  | { kind: 'edit'; sectionId: string; text: string; resolve: (a: SaveAck) => void; reject: (e: unknown) => void }
  | { kind: 'clear'; sectionId: string; resolve: (a: SaveAck) => void; reject: (e: unknown) => void }
  | { kind: 'rename'; sectionId: string; title: string; resolve: (a: SaveAck) => void; reject: (e: unknown) => void }
  | {
      kind: 'own';
      title: string;
      text: string;
      resolve: (a: SaveAck & { sectionId?: string }) => void;
      reject: (e: unknown) => void;
    }
  | { kind: 'finish'; resolve: (s: CaseSheet) => void; reject: (e: unknown) => void };

interface Baseline {
  answers: Answers;
  rowVersion: number;
  patient: PatientBlock;
  visited: string[];
}

interface InFlight {
  body: CaseSave;
  answers: Answers;
  patient: PatientBlock;
  visited: string[];
}

const isNetwork = (e: unknown) => e instanceof HttpErrorResponse && e.status === 0;
const isServer = (e: unknown) => e instanceof HttpErrorResponse && e.status >= 500;
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Keep the last occurrence of each page key, in order (the current page ends the list). */
export function normaliseVisited(keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    if (!k) continue;
    const i = out.indexOf(k);
    if (i >= 0) out.splice(i, 1);
    out.push(k);
  }
  return out;
}

/** The patient block the answers describe: name (patientLabelOf), age (a field keyed age), sex (a field keyed sex / gender, by option label). */
export function patientFromAnswers(def: FormDefinition, answers: Answers): Partial<PatientBlock> {
  const out: Partial<PatientBlock> = {};
  const fields = allFields(def);
  // Does the form have a name field at all? (Then the answers own the name, even when cleared.)
  const probe: Answers = {};
  for (const f of fields) if (f.kind === 'text') probe[f.key] = 'x';
  if (patientLabelOf(def, probe)) out.name = patientLabelOf(def, answers);
  const age = fields.find((f) => /^(patient[_-]?)?age$/i.test(f.key) && (f.kind === 'number' || f.kind === 'text'));
  if (age) {
    const v = answers[age.key];
    out.age = v === null || v === undefined || v === '' ? null : String(v).slice(0, 30);
  }
  const sex = fields.find((f) => /^(patient[_-]?)?(sex|gender)$/i.test(f.key));
  if (sex) {
    const v = answers[sex.key];
    const opt = sex.options?.find((o) => typeof v === 'string' && o.key.toLowerCase() === v.toLowerCase());
    out.sex = v === null || v === undefined || v === '' ? null : (opt?.label ?? String(v)).slice(0, 20);
  }
  return out;
}

/**
 * The patient block as it will be saved: the sheet's own block, then what the answers say, then what was typed in the
 * header. A sheet LINKED to a patient record (`patientId`: the lab's LMS patient, the public site's own patient) keeps
 * its snapshot where the form's name / age / sex field is still empty — an empty answer never blanks the patient's
 * name (WP11: a personal sheet started for "Lakshmanan Pillai" saved as "No name yet"). Unlinked sheets keep Prepare's
 * rule: the answers own those fields, even when cleared.
 */
export function mergePatient(
  base: PatientBlock,
  derived: Partial<PatientBlock>,
  manual: Partial<PatientBlock>,
  linked: boolean,
): PatientBlock {
  const fromAnswers = linked
    ? (Object.fromEntries(Object.entries(derived).filter(([, v]) => v !== null && v !== undefined && v !== '')) as Partial<PatientBlock>)
    : derived;
  return { ...base, ...fromAnswers, ...manual };
}

/**
 * One open case sheet: the ONE place it is loaded and saved (plan §6
 * "Autosave"). Provide it per filler page (`providers: [CaseSession]`).
 *
 *  - every change is cached on the device at once, then saved 800 ms after
 *    the last tap as a PATCH of only what changed;
 *  - every write (saves, section edits, Finish) goes through one serial
 *    queue, so row versions never race;
 *  - offline / server trouble: the same save (same requestId) is retried
 *    with backoff and at once when the tablet comes back online;
 *  - another device saved first (409): saving stops until the doctor picks
 *    "use theirs" or "keep mine".
 */
@Injectable()
export class CaseSession {
  private readonly api = inject(CasesApi);
  private readonly cache: CaseCache = inject(CASE_CACHE);
  private readonly timing = inject(SESSION_TIMING);

  readonly sheet = signal<CaseSheet | null>(null);
  readonly definition = signal<FormDefinition | null>(null);
  readonly answers = signal<Answers>({});
  readonly saveState = signal<SaveState>('saved');
  readonly lastSavedAt = signal<Date | null>(null);
  readonly conflict = signal<CaseSheet | null>(null);
  readonly narrative = signal<CaseNarrative | null>(null);
  readonly narrativeState = signal<NarrativeState>('idle');
  readonly loadError = signal<unknown>(null);
  readonly loading = signal(false);
  /** The sheet was opened from this device's copy because the API could not be reached. */
  readonly fromCache = signal(false);

  readonly saveText = computed(() => SAVE_STATE_TEXT[this.saveState()]);
  readonly isFinal = computed(() => this.sheet()?.state === 'final');

  private id: string | null = null;
  private server: Baseline | null = null;
  private visited: string[] = [];
  private manualPatient: Partial<PatientBlock> = {};
  private inFlight: InFlight | null = null;
  private sendAll = false;
  private jobs: Job[] = [];
  private busy = false;
  private attempt = 0;
  private lastError: unknown = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private narrativeTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  private destroyed = false;
  private readonly onOnline = () => this.retryNow();

  constructor() {
    inject(DestroyRef, { optional: true })?.onDestroy(() => this.destroy());
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
  }

  // ---------------- open ----------------

  async open(id: string): Promise<void> {
    this.id = id;
    this.loading.set(true);
    this.loadError.set(null);
    this.fromCache.set(false);
    const cached = await this.cache.getSheet(id);
    let sheet: CaseSheet;
    let offline = false;
    try {
      sheet = await this.api.getCase(id);
    } catch (e) {
      if ((isNetwork(e) || isServer(e)) && cached) {
        sheet = cached.sheet;
        offline = true;
      } else {
        this.loadError.set(e);
        this.loading.set(false);
        return;
      }
    }
    let definition: FormDefinition | null = offline ? await this.cache.getForm(sheet.formVersionId) : null;
    if (!definition) {
      try {
        definition = await this.api.formVersion(sheet.formId, sheet.formVersionId);
        await this.cache.putForm(sheet.formVersionId, definition);
      } catch (e) {
        definition = await this.cache.getForm(sheet.formVersionId);
        if (!definition) {
          this.loadError.set(e);
          this.loading.set(false);
          return;
        }
        offline = offline || isNetwork(e);
      }
    }
    this.definition.set(definition);
    this.server = {
      answers: clone(sheet.answers),
      rowVersion: sheet.rowVersion,
      patient: { ...sheet.patient },
      visited: [...sheet.visitedPages],
    };
    this.visited = [...sheet.visitedPages];
    this.fromCache.set(offline);
    let local = clone(sheet.answers);

    if (cached?.dirty && sheet.state === 'draft') {
      local = clone(cached.localAnswers);
      this.visited = normaliseVisited(cached.visited ?? this.visited);
      this.manualPatient = { ...(cached.patient ?? {}) };
      if (cached.sheet.rowVersion !== sheet.rowVersion && !offline) {
        // Someone saved from another device after this tablet's last save: the doctor decides.
        this.sheet.set(sheet);
        this.answers.set(local);
        this.conflict.set(sheet);
        this.saveState.set('conflict');
        this.loading.set(false);
        this.scheduleNarrative(0);
        return;
      }
    }
    this.sheet.set(sheet);
    this.answers.set(local);
    this.conflict.set(null);
    this.loading.set(false);
    if (sheet.state === 'final') {
      this.saveState.set('final');
    } else if (this.dirty()) {
      this.saveState.set(offline ? 'offline' : 'pending');
      this.scheduleSave(0);
    } else {
      this.saveState.set('saved');
      await this.writeCache(false);
    }
    this.scheduleNarrative(0);
  }

  // ---------------- changes ----------------

  /** The doctor's answers changed (already through links + triggers). */
  setAnswers(next: Answers): void {
    if (this.isFinal()) return;
    this.answers.set(next);
    void this.writeCache(true);
    if (this.saveState() === 'conflict') return;
    if (this.saveState() !== 'offline' && this.saveState() !== 'error') this.saveState.set('pending');
    this.scheduleSave();
  }

  /** Pages reached (KEYS), current page last. Rides on the next save. */
  setVisited(pageKeys: readonly string[]): void {
    const v = normaliseVisited(pageKeys);
    if (valuesEqual(v, this.visited)) return;
    this.visited = v;
    if (this.isFinal()) return;
    void this.writeCache(this.dirty());
    if (this.saveState() === 'conflict') return;
    this.scheduleSave();
  }

  /** For forms with no name / age / sex field: the patient block typed in the header. */
  setPatient(patch: Partial<PatientBlock>): void {
    this.manualPatient = { ...this.manualPatient, ...patch };
    if (this.isFinal()) return;
    void this.writeCache(true);
    if (this.saveState() === 'conflict') return;
    this.saveState.set('pending');
    this.scheduleSave();
  }

  /** The patient block as it will be saved. */
  readonly patient = computed<PatientBlock>(() => {
    const def = this.definition();
    const base = this.sheet()?.patient ?? { name: null, age: null, sex: null, ref: null };
    this.answers(); // track
    const derived = def ? patientFromAnswers(def, this.answers()) : {};
    return mergePatient(base, derived, this.manualPatient, !!this.sheet()?.patientId);
  });

  editSection(sectionId: string, text: string): Promise<SaveAck> {
    return new Promise<SaveAck>((resolve, reject) => {
      this.jobs.push({ kind: 'edit', sectionId, text, resolve, reject });
      this.kick();
    });
  }

  clearSection(sectionId: string): Promise<SaveAck> {
    return new Promise<SaveAck>((resolve, reject) => {
      this.jobs.push({ kind: 'clear', sectionId, resolve, reject });
      this.kick();
    });
  }

  renameSection(sectionId: string, title: string): Promise<SaveAck> {
    return new Promise<SaveAck>((resolve, reject) => {
      this.jobs.push({ kind: 'rename', sectionId, title, resolve, reject });
      this.kick();
    });
  }

  /** Add a section of the doctor's own (title + words); resolves with its id. */
  addOwnSection(title: string, text = ''): Promise<SaveAck & { sectionId?: string }> {
    return new Promise<SaveAck & { sectionId?: string }>((resolve, reject) => {
      this.jobs.push({ kind: 'own', title, text, resolve, reject });
      this.kick();
    });
  }

  /** Save everything now; resolves when nothing is waiting, rejects with the error if the last attempt failed. */
  flush(): Promise<void> {
    if (this.idle()) return Promise.resolve();
    if (this.saveState() === 'conflict') return Promise.reject(new CaseConflict(this.conflict()));
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.kick();
    });
  }

  /** Save, then finish (the API checks required answers and makes the PDF). FinishRefused passes through. */
  async finish(): Promise<CaseSheet> {
    await this.flush();
    return new Promise<CaseSheet>((resolve, reject) => {
      this.jobs.push({ kind: 'finish', resolve, reject });
      this.kick();
    });
  }

  /** After a 409: take the other device's copy, or keep this tablet's answers on top of it. */
  async resolveConflict(choice: 'theirs' | 'mine'): Promise<void> {
    const theirs = this.conflict();
    if (!theirs) return;
    this.server = {
      answers: clone(theirs.answers),
      rowVersion: theirs.rowVersion,
      patient: { ...theirs.patient },
      visited: [...theirs.visitedPages],
    };
    this.inFlight = null;
    this.conflict.set(null);
    this.sheet.set(theirs);
    if (theirs.state === 'final') {
      this.answers.set(clone(theirs.answers));
      this.saveState.set('final');
      await this.writeCache(false);
      return;
    }
    if (choice === 'theirs') {
      this.answers.set(clone(theirs.answers));
      this.visited = [...theirs.visitedPages];
      this.manualPatient = {};
      this.saveState.set('saved');
      await this.writeCache(false);
      this.scheduleNarrative(0);
      this.settleWaiters();
    } else {
      this.sendAll = true;
      this.saveState.set('pending');
      await this.writeCache(true);
      this.kick();
    }
  }

  /** Fetch the narrative again (the screen's "Try again"). */
  refreshNarrative(): void {
    this.scheduleNarrative(0);
  }

  destroy(): void {
    this.destroyed = true;
    for (const t of [this.saveTimer, this.retryTimer, this.narrativeTimer]) if (t) clearTimeout(t);
    this.saveTimer = this.retryTimer = this.narrativeTimer = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
  }

  // ---------------- the queue ----------------

  private dirty(): boolean {
    if (!this.server || !this.definition()) return false;
    if (this.sendAll || this.inFlight) return true;
    return !!this.buildSave(false);
  }

  private idle(): boolean {
    return !this.busy && !this.dirty() && this.jobs.length === 0;
  }

  private scheduleSave(ms = this.timing.debounceMs): void {
    if (this.destroyed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.pump();
    }, ms);
  }

  private kick(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.retryTimer) return; // a retry is already waiting; flush waiters ride on it
    void this.pump();
  }

  private retryNow(): void {
    if (this.destroyed) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.saveState() === 'offline' || this.saveState() === 'error') void this.pump();
    if (this.narrativeState() === 'offline') this.scheduleNarrative(0);
  }

  /** The PATCH for what changed since the last acknowledged copy, or null when nothing did. */
  private buildSave(forSend: boolean): InFlight | null {
    const s = this.server!;
    const local = this.answers();
    const answers: Answers = {};
    const remove: string[] = [];
    // Only keys the pinned form has (the API refuses others with 400 unknown_field).
    const known = this.fieldKeys();
    for (const [k, v] of Object.entries(local)) {
      if (v === undefined || !known.has(k)) continue;
      if (this.sendAll || !valuesEqual(v, s.answers[k])) answers[k] = clone(v);
    }
    for (const k of Object.keys(s.answers)) if (local[k] === undefined) remove.push(k);
    const want = this.patient();
    const patient: Partial<PatientBlock> = {};
    for (const k of ['name', 'age', 'sex', 'ref'] as const)
      if ((want[k] ?? null) !== (s.patient[k] ?? null)) patient[k] = want[k] ?? null;
    const pages = new Set((this.definition()?.pages ?? []).map((p) => p.key));
    const visited = this.visited.filter((k) => pages.has(k));
    const visitedChanged = !valuesEqual(visited, s.visited);
    const any =
      Object.keys(answers).length > 0 || remove.length > 0 || Object.keys(patient).length > 0 || visitedChanged;
    if (!any && !this.sendAll) return null;
    if (!forSend) return { body: { rowVersion: s.rowVersion, requestId: '' }, answers: local, patient: want, visited };
    const body: CaseSave = { rowVersion: s.rowVersion, requestId: newRequestId() };
    if (Object.keys(answers).length) body.answers = answers;
    if (remove.length) body.remove = remove;
    if (Object.keys(patient).length) body.patient = patient;
    if (visitedChanged) body.visitedPages = [...visited];
    return { body, answers: clone(local), patient: { ...want }, visited: [...visited] };
  }

  private keysFor: FormDefinition | null = null;
  private keys = new Set<string>();
  private fieldKeys(): Set<string> {
    const def = this.definition();
    if (def !== this.keysFor) {
      this.keysFor = def;
      this.keys = new Set(def ? allFields(def).map((f) => f.key) : []);
    }
    return this.keys;
  }

  private async pump(): Promise<void> {
    if (this.busy || this.destroyed || !this.id || !this.server) return;
    if (this.saveState() === 'conflict' || (this.saveState() === 'final' && !this.jobs.length)) {
      this.settleWaiters();
      return;
    }
    this.busy = true;
    try {
      for (;;) {
        if (this.destroyed) return;
        if (this.inFlight || (this.saveState() !== 'final' && this.dirty())) {
          if (!(await this.saveStep())) return;
          continue;
        }
        const job = this.jobs[0];
        if (job) {
          if (!(await this.jobStep(job))) return;
          continue;
        }
        break;
      }
      if (this.saveState() !== 'final' && this.saveState() !== 'conflict') this.saveState.set('saved');
      this.settleWaiters();
    } finally {
      this.busy = false;
    }
  }

  /** One save. Returns false when the queue must stop (waiting for a retry, a conflict, a finished sheet). */
  private async saveStep(): Promise<boolean> {
    if (!this.inFlight) {
      this.inFlight = this.buildSave(true);
      this.sendAll = false;
      if (!this.inFlight) return true;
    }
    const sent = this.inFlight;
    this.saveState.set('saving');
    try {
      const ack = await this.api.saveCase(this.id!, sent.body);
      this.server = { answers: sent.answers, rowVersion: ack.rowVersion, patient: sent.patient, visited: sent.visited };
      this.inFlight = null;
      this.attempt = 0;
      this.lastError = null;
      this.lastSavedAt.set(new Date());
      this.patchSheet(ack, sent);
      const more = this.dirty();
      this.saveState.set(more ? 'pending' : 'saved');
      await this.writeCache(more);
      this.scheduleNarrative();
      return true;
    } catch (e) {
      return this.failed(e, () => {
        this.inFlight = null;
      });
    }
  }

  private async jobStep(job: Job): Promise<boolean> {
    const rv = this.server!.rowVersion;
    try {
      if (job.kind === 'finish') {
        this.saveState.set('saving');
        const done = await this.api.finishCase(this.id!, rv);
        this.jobs.shift();
        this.server = { ...this.server!, rowVersion: done.rowVersion, answers: clone(done.answers) };
        this.sheet.set(done);
        this.saveState.set('final');
        await this.writeCache(false);
        this.scheduleNarrative(0);
        job.resolve(done);
        return true;
      }
      const ack: SaveAck & { sectionId?: string } =
        job.kind === 'edit'
          ? await this.api.editSection(this.id!, job.sectionId, job.text, rv)
          : job.kind === 'rename'
            ? await this.api.renameSection(this.id!, job.sectionId, job.title, rv)
            : job.kind === 'own'
              ? await this.api.addOwnSection(this.id!, { title: job.title, text: job.text }, rv)
              : await this.api.clearSection(this.id!, job.sectionId, rv);
      this.jobs.shift();
      this.server = { ...this.server!, rowVersion: ack.rowVersion };
      this.patchSheet(ack);
      await this.writeCache(this.dirty());
      this.scheduleNarrative(0);
      job.resolve(ack);
      return true;
    } catch (e) {
      if (isNetwork(e) || isServer(e)) return this.failed(e, () => undefined);
      this.jobs.shift();
      if (e instanceof CaseConflict || e instanceof CaseFinal) {
        job.reject(e);
        return this.failed(e, () => undefined);
      }
      if (job.kind === 'finish' && this.saveState() === 'saving') this.saveState.set('saved');
      job.reject(e);
      return true;
    }
  }

  /** Decide what a failed write means. Returns false (stop the queue). */
  private failed(e: unknown, dropRequest: () => void): boolean {
    this.lastError = e;
    if (isNetwork(e) || isServer(e)) {
      this.saveState.set(isNetwork(e) ? 'offline' : 'error');
      const wait = this.timing.backoff(this.attempt++);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.pump();
      }, wait);
      this.rejectWaiters(e);
      return false;
    }
    dropRequest();
    if (e instanceof CaseConflict) {
      this.conflict.set(e.current);
      this.saveState.set('conflict');
      this.failJobs(e);
      this.rejectWaiters(e);
      return false;
    }
    if (e instanceof CaseFinal) {
      this.saveState.set('final');
      this.failJobs(e);
      this.rejectWaiters(e);
      void this.api
        .getCase(this.id!)
        .then((s) => this.sheet.set(s))
        .catch(() => undefined);
      return false;
    }
    // A refusal we can't fix by retrying (e.g. a field the form no longer has).
    this.saveState.set('error');
    this.rejectWaiters(e);
    return false;
  }

  private failJobs(e: unknown): void {
    const jobs = this.jobs;
    this.jobs = [];
    for (const j of jobs) j.reject(e);
  }

  private settleWaiters(): void {
    // Called from inside the pump too (busy is still set there): only the work matters.
    const nothingLeft = !this.dirty() && this.jobs.length === 0;
    if (!nothingLeft && this.saveState() !== 'conflict') return;
    const w = this.waiters;
    this.waiters = [];
    if (this.saveState() === 'conflict') for (const x of w) x.reject(new CaseConflict(this.conflict()));
    else for (const x of w) x.resolve();
  }

  private rejectWaiters(e: unknown): void {
    const w = this.waiters;
    this.waiters = [];
    for (const x of w) x.reject(e);
  }

  private patchSheet(ack: SaveAck, sent?: InFlight): void {
    const s = this.sheet();
    if (!s) return;
    this.sheet.set({
      ...s,
      rowVersion: ack.rowVersion,
      updatedAt: ack.updatedAt || s.updatedAt,
      state: ack.state ?? s.state,
      ...(sent
        ? { answers: sent.answers, patient: { ...s.patient, ...sent.patient }, visitedPages: sent.visited }
        : {}),
    });
  }

  private async writeCache(dirty: boolean): Promise<void> {
    const sheet = this.sheet();
    if (!this.id || !sheet) return;
    const base: CaseSheet = this.server
      ? { ...sheet, rowVersion: this.server.rowVersion, answers: this.server.answers }
      : sheet;
    try {
      await this.cache.putSheet(this.id, {
        sheet: base,
        localAnswers: this.answers(),
        visited: this.visited,
        patient: Object.keys(this.manualPatient).length ? this.manualPatient : null,
        dirty,
        savedAt: Date.now(),
      });
    } catch {
      /* the cache is a convenience; never fail a tap on it */
    }
  }

  // ---------------- narrative ----------------

  private scheduleNarrative(ms = this.timing.narrativeDebounceMs): void {
    if (this.destroyed || !this.id) return;
    if (this.narrativeTimer) clearTimeout(this.narrativeTimer);
    this.narrativeTimer = setTimeout(() => {
      this.narrativeTimer = null;
      void this.loadNarrative();
    }, ms);
  }

  private async loadNarrative(): Promise<void> {
    const id = this.id;
    if (!id) return;
    this.narrativeState.set('loading');
    try {
      const n = await this.api.narrative(id);
      if (this.id !== id || this.destroyed) return;
      this.narrative.set(n);
      this.narrativeState.set('idle');
    } catch (e) {
      if (this.id !== id || this.destroyed) return;
      this.narrativeState.set(isNetwork(e) ? 'offline' : 'error');
    }
  }

  /** For specs and the screen's "Try again": the error behind 'offline' / 'error'. */
  get error(): unknown {
    return this.lastError;
  }
}
