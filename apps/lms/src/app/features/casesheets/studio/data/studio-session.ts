import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { FormDefinition } from '@prefrontal/forms-engine';
import { StudioApi } from './studio-api';
import { DraftConflict, Editor, LivePreview, Problem, PublishRefused, Version, plainError } from './studio-models';

export type StudioSaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error';

/** Debounce for saving the draft after an edit. */
export const SAVE_DEBOUNCE_MS = 800;
/** Debounce for the live narrative after an edit (plan §5: ~300 ms). */
export const PREVIEW_DEBOUNCE_MS = 300;
/** "Also editing" ping (the API keeps a person for 45 s). */
export const PRESENCE_EVERY_MS = 20_000;
const UNDO_LIMIT = 60;

/** A throttled preview (429) is asked again after 1.5 s, 3 s, … up to 6 times. */
export const PREVIEW_RETRY_MS = 1500;
export const PREVIEW_RETRIES = 6;

/**
 * One form open in Studio. Every edit is a new definition (pure edits from
 * forms-engine); the session keeps the undo trail, saves the ONE open draft
 * 800 ms after the last edit (optimistic: the row version; a 409 keeps both
 * copies and asks), asks the API for the live narrative 300 ms after the
 * last edit, and pings presence so "Dr X is also editing" can show.
 *
 * A form with no open draft is opened on its live version; the first edit
 * starts the draft (so just looking never creates a version).
 */
@Injectable()
export class StudioSession {
  private readonly api = inject(StudioApi);

  readonly formId = signal<string | null>(null);
  readonly version = signal<Version | null>(null);
  readonly definition = signal<FormDefinition | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly saveState = signal<StudioSaveState>('saved');
  readonly saveMessage = signal<string>('');
  readonly savedAt = signal<string | null>(null);
  /** Set while a save lost to someone else: their copy, kept until the person chooses. */
  readonly conflict = signal<DraftConflict | null>(null);
  readonly editors = signal<Editor[]>([]);
  readonly preview = signal<LivePreview | null>(null);
  readonly previewState = signal<'idle' | 'loading' | 'offline'>('idle');
  /** The API's problems for the draft as it is now (from the live preview). */
  readonly problems = signal<Problem[]>([]);

  /** A master form: shown as published, never edited here ("Edit" makes this lab's own copy first). */
  readonly readOnly = signal(false);
  /** True while the screen shows the live version and no draft exists yet. */
  readonly onLive = signal(false);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  private readonly undoStack = signal<FormDefinition[]>([]);
  /** Undone edits, newest last; any new edit clears it (⌘⇧Z / Redo). */
  private readonly redoStack = signal<FormDefinition[]>([]);

  private rowVersion = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  private previewSeq = 0;
  private previewRetries = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef, { optional: true })?.onDestroy(() => this.close());
  }

  async load(formId: string): Promise<void> {
    this.formId.set(formId);
    this.loadError.set(null);
    try {
      const form = await this.api.form(formId);
      this.readOnly.set(form.origin === 'master');
      const open = form.versions.find((v) => v.state === 'draft' || v.state === 'in_review');
      const live = form.versions.find((v) => v.id === form.currentPublishedVersionId);
      const pick = open ?? live ?? form.versions[0];
      if (!pick) throw new Error('empty');
      const v = await this.api.version(formId, pick.id);
      this.version.set(v);
      this.definition.set(v.definition);
      this.rowVersion = v.rowVersion;
      this.onLive.set(!open);
      this.savedAt.set(v.updatedAt);
      this.saveState.set('saved');
      this.undoStack.set([]);
      this.redoStack.set([]);
      this.schedulePreview(0);
      if (open) this.startPresence();
    } catch (e) {
      this.loadError.set(
        (e as { status?: number })?.status === 404 ? 'This form was not found. It may have been removed.' : plainError(e, "Can't open this form right now."),
      );
    }
  }

  /** Apply an edit (a new definition). Undo keeps the old one. */
  apply(next: FormDefinition): void {
    const cur = this.definition();
    if (!cur || next === cur || this.conflict() || this.readOnly()) return;
    this.undoStack.update((s) => [...s.slice(-UNDO_LIMIT + 1), cur]);
    this.redoStack.set([]);
    this.definition.set(next);
    this.changed();
  }

  undo(): void {
    const s = this.undoStack();
    const cur = this.definition();
    if (!s.length || !cur || this.conflict() || this.readOnly()) return;
    this.definition.set(s[s.length - 1]);
    this.undoStack.set(s.slice(0, -1));
    this.redoStack.update((r) => [...r.slice(-UNDO_LIMIT + 1), cur]);
    this.changed();
  }

  /** Put back the last undone edit. */
  redo(): void {
    const r = this.redoStack();
    const cur = this.definition();
    if (!r.length || !cur || this.conflict()) return;
    this.definition.set(r[r.length - 1]);
    this.redoStack.set(r.slice(0, -1));
    this.undoStack.update((s) => [...s.slice(-UNDO_LIMIT + 1), cur]);
    this.changed();
  }

  private changed(): void {
    this.saveState.set('dirty');
    this.schedulePreview(PREVIEW_DEBOUNCE_MS);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
  }

  /** Save now (Publish / Preview / leaving call this first). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    while (this.inflight) await this.inflight;
    if (this.saveState() !== 'dirty' && this.saveState() !== 'offline' && this.saveState() !== 'error') return;
    this.inflight = this.save().finally(() => (this.inflight = null));
    await this.inflight;
  }

  private async save(): Promise<void> {
    const formId = this.formId();
    const def = this.definition();
    if (!formId || !def) return;
    this.saveState.set('saving');
    try {
      if (this.onLive()) {
        const d = await this.api.startDraft(formId);
        this.rowVersion = d.rowVersion;
        this.version.set({ ...d, definition: def });
        this.onLive.set(false);
        this.startPresence();
      }
      const ack = await this.api.saveDraft(formId, def, this.rowVersion);
      this.rowVersion = ack.rowVersion;
      this.version.update((v) => (v ? { ...ack, definition: def } : v));
      this.savedAt.set(ack.updatedAt);
      if (ack.editors.length) this.editors.set(ack.editors);
      // an edit made while saving is saved next
      this.saveState.set(this.definition() === def ? 'saved' : 'dirty');
      if (this.definition() !== def) this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS);
    } catch (e) {
      if (e instanceof DraftConflict) {
        this.conflict.set(e);
        this.saveState.set('conflict');
        this.saveMessage.set(e.message);
        return;
      }
      const offline = (e as { status?: number })?.status === 0;
      this.saveState.set(offline ? 'offline' : 'error');
      this.saveMessage.set(plainError(e));
      if (offline) this.saveTimer = setTimeout(() => void this.flush(), 5000);
    }
  }

  /** After a conflict: take their copy (my unsaved change is dropped) or keep mine (saved over theirs, on purpose). */
  async resolve(choice: 'theirs' | 'mine'): Promise<void> {
    const c = this.conflict();
    if (!c) return;
    this.conflict.set(null);
    this.rowVersion = c.current.rowVersion;
    if (choice === 'theirs') {
      this.definition.set(c.current.definition);
      this.version.set(c.current);
      this.undoStack.set([]);
      this.redoStack.set([]);
      this.saveState.set('saved');
      this.schedulePreview(0);
      return;
    }
    this.saveState.set('dirty');
    await this.flush();
  }

  /** Publish: save first, then make it live. Throws PublishRefused (problems per field) or DraftConflict. */
  async publish(note?: string): Promise<Version> {
    await this.flush();
    const formId = this.formId()!;
    if (this.onLive()) {
      // nothing changed since the live version: publishing again is not needed
      return this.version()!;
    }
    try {
      const v = await this.api.publish(formId, this.rowVersion, note);
      this.rowVersion = v.rowVersion;
      this.version.update((cur) => (cur ? { ...v, definition: cur.definition } : v));
      this.onLive.set(true);
      this.stopPresence();
      return v;
    } catch (e) {
      if (e instanceof PublishRefused) this.problems.set(e.problems);
      if (e instanceof DraftConflict) {
        this.conflict.set(e);
        this.saveState.set('conflict');
      }
      throw e;
    }
  }

  async discard(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const formId = this.formId();
    if (formId && !this.onLive()) await this.api.discardDraft(formId);
    this.stopPresence();
  }

  // ---------------- live narrative ----------------

  private schedulePreview(ms: number): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.refreshPreview(), ms);
  }

  async refreshPreview(): Promise<void> {
    const def = this.definition();
    if (!def || this.destroyed) return;
    const seq = ++this.previewSeq;
    this.previewState.set('loading');
    try {
      const p = await this.api.livePreview(def);
      if (seq !== this.previewSeq) return; // a newer edit's answer wins
      this.preview.set(p);
      this.problems.set(p.problems);
      this.previewState.set('idle');
      this.previewRetries = 0;
    } catch (e) {
      if (seq !== this.previewSeq) return;
      const status = (e as { status?: number })?.status;
      // too many previews at once (the API throttles them): keep "Writing…" and try again shortly, never leave
      // words on screen that no longer match the form
      if (status === 429 && this.previewRetries < PREVIEW_RETRIES) {
        this.previewRetries++;
        this.schedulePreview(PREVIEW_RETRY_MS * this.previewRetries);
        return;
      }
      this.previewRetries = 0;
      this.previewState.set(status === 0 ? 'offline' : 'idle');
    }
  }

  // ---------------- presence ----------------

  private startPresence(): void {
    if (this.presenceTimer || typeof setInterval === 'undefined') return;
    const ping = async () => {
      const id = this.formId();
      if (!id || this.onLive()) return;
      try {
        this.editors.set(await this.api.presence(id));
      } catch {
        /* a hint only */
      }
    };
    void ping();
    this.presenceTimer = setInterval(() => void ping(), PRESENCE_EVERY_MS);
  }

  private stopPresence(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    this.editors.set([]);
  }

  close(): void {
    this.destroyed = true;
    const id = this.formId();
    if (this.presenceTimer && id) void this.api.leave(id).catch(() => undefined);
    this.stopPresence();
    if (this.previewTimer) clearTimeout(this.previewTimer);
    if (this.saveState() === 'dirty') void this.flush();
  }
}
