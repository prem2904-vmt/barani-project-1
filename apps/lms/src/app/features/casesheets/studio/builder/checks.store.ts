import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { DialogService } from '../../../../core/services/dialog.service';
import { StudioSession } from '../data/studio-session';
import { CaseSheetBuilderApi } from './builder-api';
import { BuilderStatusService } from './builder-status.service';
import { CheckView, ChecksResult, builderWords } from './builder-models';

/** After a successful draft save, the checks run again this long after the LAST save. */
export const RERUN_DEBOUNCE_MS = 1500;

/**
 * The option checks of the open form. Owner decision: failing checks WARN only; nothing here ever blocks Publish.
 * The server plays every check (deterministically); this only asks, lists and removes.
 */
@Injectable()
export class ChecksStore {
  private readonly api = inject(CaseSheetBuilderApi);
  private readonly session = inject(StudioSession);
  private readonly status = inject(BuilderStatusService);
  private readonly dialog = inject(DialogService);

  readonly result = signal<ChecksResult | null>(null);
  readonly busy = signal<'load' | 'run' | 'suggest' | null>(null);
  readonly error = signal('');

  readonly checks = computed<CheckView[]>(() => this.result()?.checks ?? []);
  readonly summary = computed(() => this.result()?.summary ?? null);
  /** How many checks fail right now (0 until something has run). */
  readonly failing = computed(() => this.result()?.summary.failed ?? 0);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private seenSave: string | null | undefined = undefined;

  constructor() {
    // the form opened: read what the server already knows
    effect(() => {
      const id = this.session.formId();
      if (id && this.status.available()) untracked(() => void this.load());
    });
    // re-run after every successful draft save (debounced)
    effect(() => {
      const at = this.session.savedAt();
      const first = this.seenSave === undefined;
      const same = at === this.seenSave;
      this.seenSave = at;
      if (first || same || !this.status.available()) return;
      untracked(() => this.rerunSoon());
    });
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
  }

  private rerunSoon(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, RERUN_DEBOUNCE_MS);
  }

  private async go(kind: 'load' | 'run' | 'suggest', call: (id: string) => Promise<ChecksResult>): Promise<void> {
    const id = this.session.formId();
    if (!id) return;
    const mine = ++this.seq;
    this.busy.set(kind);
    this.error.set('');
    try {
      const r = await call(id);
      if (mine === this.seq) this.result.set(r);
    } catch (e) {
      if (mine === this.seq) this.error.set(builderWords(e, "Couldn't run the checks just now."));
    } finally {
      if (mine === this.seq) this.busy.set(null);
    }
  }

  load(): Promise<void> { return this.go('load', (id) => this.api.checks(id)); }
  /** Save what's on screen first, so the checks play the same draft the person sees. */
  async run(): Promise<void> {
    await this.session.flush();
    return this.go('run', (id) => this.api.runChecks(id));
  }
  async suggest(): Promise<void> {
    await this.session.flush();
    return this.go('suggest', (id) => this.api.suggestChecks(id));
  }

  /** Remove a non-auto check (asks first). */
  async remove(c: CheckView): Promise<void> {
    if (c.source === 'auto') return;
    const ok = await this.dialog.confirm({
      title: 'Remove this check?',
      message: `“${c.title}” will no longer be played. The form itself does not change.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    const id = this.session.formId();
    if (!id) return;
    try {
      await this.api.removeCheck(id, c.id);
      this.result.update((r) => {
        if (!r) return r;
        const checks = r.checks.filter((x) => x.id !== c.id);
        const passed = checks.filter((x) => x.result?.pass).length;
        const failed = checks.filter((x) => x.result && !x.result.pass).length;
        return { checks, summary: { ...r.summary, total: checks.length, passed, failed } };
      });
    } catch (e) {
      this.error.set(builderWords(e, "Couldn't remove the check."));
    }
  }
}
