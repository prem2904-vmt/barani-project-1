import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { casesheetLinks } from '../../casesheets.routes';
import { StudioApi } from '../data/studio-api';
import { DraftFromSheetInput, DraftJobStatus, DraftMade, DraftProgress } from '../data/studio-models';
import { NOT_AVAILABLE, jobFailure, madeDrafts, opensStraightAway, startRefusal } from './cortex-import';

export const POLL_MS = 2000;
/** Lost connection this many polls in a row ⇒ stop and say so. */
const MAX_POLL_ERRORS = 5;

export interface RunningImport {
  jobId: string;
  /** What the chip calls it: the name the user typed, else "your case sheet". */
  name: string;
  status: DraftJobStatus;
  /** Set when the job is done (the first case sheet). */
  formId?: string;
  checkCount?: number;
  /** Set when the job is done: every case sheet made (a booklet of several proformas makes several). */
  drafts?: DraftMade[];
  /** Set when the job is done: the job's own notes (pages left out, a case sheet that could not be made). */
  warnings?: string[];
  /** While reading: the server's words and parts done of parts planned. */
  progress?: DraftProgress;
  /** Plain words, when the job failed. */
  failure?: string;
}

/**
 * One "case sheet from a paper sheet" job at a time (the app's, not the dialog's: the dialog can be closed and the job keeps
 * going). Starts the job, polls it every 2 s, and when it is done opens the editor, or, if the progress view was
 * closed, leaves the finished draft on Studio's chip to open. A job that made SEVERAL case sheets (a long booklet), or
 * left a warning, never jumps away: the progress view lists them, each with its own Open. Never throws; every refusal
 * ends up as words.
 */
@Injectable({ providedIn: 'root' })
export class CortexImportService implements OnDestroy {
  private readonly api = inject(StudioApi);
  private readonly router = inject(Router);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private errors = 0;

  /** The job being watched (or just finished, until the person opens or dismisses it). */
  readonly job = signal<RunningImport | null>(null);
  /** The progress view is open. */
  readonly viewing = signal(false);
  /** Words for a refused start (the dialog shows them). */
  readonly startError = signal('');
  readonly starting = signal(false);
  /** The server doesn't offer this (404 / 424 with no code): the Studio button goes away. */
  readonly unavailable = signal(false);

  readonly running = computed(() => {
    const j = this.job();
    return !!j && j.status !== 'done' && j.status !== 'failed';
  });

  async start(input: DraftFromSheetInput): Promise<boolean> {
    if (this.starting() || this.running()) return false;
    this.startError.set('');
    this.starting.set(true);
    try {
      const { jobId } = await this.api.draftFromSheet(input);
      this.errors = 0;
      this.job.set({ jobId, name: input.title?.trim() || 'your case sheet', status: 'queued' });
      this.viewing.set(true);
      this.schedule(0);
      return true;
    } catch (e) {
      const words = startRefusal(e);
      if (words === NOT_AVAILABLE) this.unavailable.set(true);
      this.startError.set(words);
      return false;
    } finally {
      this.starting.set(false);
    }
  }

  /** Close the progress view; the job keeps running and Studio shows the chip. */
  hide(): void {
    this.viewing.set(false);
  }

  /** Show the progress view again (from the chip). */
  show(): void {
    this.viewing.set(true);
  }

  /** Forget the finished or failed job (and stop watching a running one). */
  dismiss(): void {
    this.stop();
    this.job.set(null);
    this.viewing.set(false);
    this.startError.set('');
  }

  /**
   * Open a finished case sheet in the editor (the first one when no id is given). With one case sheet the job is
   * done with; with several the list stays (on the chip) so the others can still be opened.
   */
  async open(formId?: string): Promise<void> {
    const j = this.job();
    const id = formId ?? j?.formId;
    if (!j || !id) return;
    this.stop();
    if ((j.drafts?.length ?? 1) <= 1) this.job.set(null);
    this.viewing.set(false);
    await this.router.navigate([casesheetLinks.adminForm(id)]);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.stop();
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    const cur = this.job();
    if (!cur) return;
    try {
      const r = await this.api.draftJob(cur.jobId);
      if (this.job()?.jobId !== cur.jobId) return; // dismissed or replaced while asking
      this.errors = 0;
      if (r.status === 'failed') {
        this.job.set({ ...cur, status: 'failed', failure: jobFailure(r.code) });
        return;
      }
      const drafts = r.status === 'done' ? madeDrafts(r, cur.name) : [];
      if (drafts.length) {
        this.job.set({ ...cur, status: 'done', formId: drafts[0].formId, checkCount: drafts[0].checkCount, drafts, warnings: r.warnings ?? [], progress: undefined });
        if (this.viewing() && opensStraightAway(drafts, r.warnings)) await this.open();
        return;
      }
      this.job.set({ ...cur, status: r.status === 'done' ? 'checking' : r.status, progress: r.progress ?? cur.progress });
      this.schedule(POLL_MS);
    } catch (e) {
      if (this.job()?.jobId !== cur.jobId) return;
      const status = (e as { status?: number })?.status;
      if (status === 404) {
        this.job.set({ ...cur, status: 'failed', failure: 'This job has expired. Start again.' });
        return;
      }
      if (++this.errors >= MAX_POLL_ERRORS) {
        this.job.set({ ...cur, status: 'failed', failure: "Lost the connection to Cortex. Check your internet and start again." });
        return;
      }
      this.schedule(POLL_MS);
    }
  }
}
