import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { PfSenseService } from '../../core/services/pf-sense.service';
import { ToastService } from '../../core/services/toast.service';
import { SelectComponent, PfSelectOption } from '../primitives/select.component';
import { ActionsMenuComponent, ActionsMenuTriggerDirective } from '../components/actions-menu/actions-menu.component';
import { InstrumentBridgeService } from '../instruments/instrument-bridge.service';
import { AssistantApiService } from './assistant-api.service';
import {
  AssistantErrorView, CONFIDENCE_WORDS, MAX_PROMPT_CHARS, PF_SENSE_LIMIT_MESSAGE, assistantError, historyFor, mappingCodeLabel, mappingTestLabel,
  availableModelCount, modelMenuActions, modelSwitchLabel, pickProvider, rateCardBreakdown, rateCardHeadline, unmatchedHeading, unmatchedMore,
} from './assistant-logic';
import { PREPARE_WORDS, RATE_CARD_PREPARE, RateCardPrepareException } from './rate-card-pages';
import { MdBlock, parseAssistantMarkdown } from './assistant-markdown';
import {
  ASSISTANT_COPY, ASSISTANT_STARTERS, ASSISTANT_TITLES, AssistantPageContext, AssistantProvider, AssistantProviderId, AssistantSuggestion,
  AssistantTestRef, AssistantTurn, ChangesSuggestion, MappingPrefill, MappingSuggestion, ProposalStatus, RateCardSummary,
} from './assistant.models';

/** One row of the conversation. */
export type ChatItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string; blocks: MdBlock[]; suggestions: AssistantSuggestion[]; by: string }
  | { id: number; kind: 'error'; error: AssistantErrorView }
  | { id: number; kind: 'card'; phase: CardPhase; step: string; summary: RateCardSummary | null; error: AssistantErrorView | null; canRetry: boolean };

/** Where a rate-card read stands (drives the progress / result card). */
export type CardPhase = 'preparing' | 'uploading' | 'reading' | 'done' | 'error';

type DiagState = 'none' | 'loading' | 'attached' | 'removed' | 'failed';

const PROVIDER_KEY = 'pf.assistant.provider';
const DIAG_TIMEOUT_MS = 10_000;

/**
 * The assistant side panel (BETA). Reusable: the host page passes a
 * {@link AssistantPageContext} (which assistant, the subject, an optional
 * instrument picker / network check, or its own `chat` transport) and listens
 * for `addMapping` / `keepProposal` / `undoProposal`; the panel never changes
 * anything itself — every suggestion is applied by a person in the page's own
 * editor. Instrument-only parts (picker, network check, mapping cards) only
 * appear on the instruments page.
 *
 * `docked`: on wide screens a host may dock the panel into its own layout
 * column (Insights edit mode) instead of floating it; phones always get the
 * full-screen sheet.
 *
 * ND sheet: a right-side card on desktop (the page stays usable beside it),
 * a full-screen sheet on phones. The model switch is a quiet sparkle + name
 * inside the composer (a small menu; unavailable greyed),
 * starter prompts, the chat (model text rendered as TEXT tokens — never
 * HTML), suggestion cards (setting + Copy, action, mapping + Add to mapping),
 * this PC's network check as a removable chip (desktop app only).
 */
@Component({
  selector: 'pf-assistant-panel',
  standalone: true,
  imports: [SelectComponent, NgTemplateOutlet, ActionsMenuComponent, ActionsMenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assistant-panel.component.html',
  styleUrl: './assistant-panel.component.scss',
})
export class AssistantPanelComponent {
  private readonly beta = inject(BetaFeaturesService);
  private readonly sense = inject(PfSenseService);
  private readonly api = inject(AssistantApiService);
  private readonly toasts = inject(ToastService);
  private readonly bridge = inject(InstrumentBridgeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly prepare = inject(RATE_CARD_PREPARE);

  readonly open = input(false);
  readonly context = input.required<AssistantPageContext>();
  readonly closed = output<void>();
  readonly addMapping = output<MappingPrefill>();
  readonly keepProposal = output<string>();
  readonly undoProposal = output<string>();
  /** "Review in Pending": the host opens its Pending view (filtered to a rate-card batch when it has an id). */
  readonly openPending = output<string | null>();
  /** Sit in the host's layout instead of floating over the page (≥ 641px). */
  readonly docked = input(false);

  protected readonly codeLabel = mappingCodeLabel;
  protected readonly testLabel = mappingTestLabel;
  protected readonly maxChars = MAX_PROMPT_CHARS;

  readonly visible = computed(() => this.open() && this.beta.enabled('assistant'));
  readonly title = computed(() => ASSISTANT_TITLES[this.context().page] ?? 'Assistant');
  readonly starters = computed(() => ASSISTANT_STARTERS[this.context().page] ?? []);
  readonly copyText = computed(() => ASSISTANT_COPY[this.context().page] ?? ASSISTANT_COPY.instruments);
  readonly isInstruments = computed(() => this.context().page === 'instruments');
  /** Test Master: the composer gets Attach + camera (a rate card is read from photos / a PDF). */
  readonly attachOn = computed(() => this.context().attachments === 'rate-card');
  protected readonly cardHeadline = rateCardHeadline;
  protected readonly cardBreakdown = rateCardBreakdown;
  protected readonly unmatchedHeading = unmatchedHeading;
  protected readonly unmatchedMore = unmatchedMore;

  // ── Models ───────────────────────────────────────────────────────────
  readonly providers = signal<AssistantProvider[]>([]);
  readonly providersState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly providersError = signal<AssistantErrorView | null>(null);
  readonly provider = signal<AssistantProviderId | null>(null);
  /** Composer model switch: the menu rows, and whether there is a choice at
   *  all (one model → just its name; none → hidden, the empty state says so). */
  readonly modelActions = computed(() => modelMenuActions(this.providers(), this.provider()));
  readonly modelChoice = computed(() => availableModelCount(this.providers()) > 1);
  readonly showModel = computed(() => this.providersState() === 'ready' && !this.noneAvailable() && !!this.provider());
  readonly modelAria = computed(() => modelSwitchLabel(this.providerLabel(), this.modelChoice()));
  readonly providerLabel = computed(() => this.providers().find((p) => p.id === this.provider())?.label ?? 'This engine');
  readonly noneAvailable = computed(() => this.providersState() === 'ready' && !this.providers().some((p) => p.available));

  // ── Subject (list page: pick an instrument) ──────────────────────────
  readonly instrumentPick = signal<string>('');
  readonly instrumentOpts = computed<PfSelectOption<string>[]>(() => {
    const list = this.context().instruments ?? [];
    return [{ value: '', label: 'All instruments' }, ...list.map((i) => ({ value: i.id, label: i.name }))];
  });
  readonly showInstrumentPick = computed(() => this.isInstruments() && !this.context().instrumentId && (this.context().instruments?.length ?? 0) > 0);
  readonly instrumentId = computed(() => this.context().instrumentId || this.instrumentPick() || null);
  readonly canAddMapping = computed(() => this.context().canAddMapping ?? !!this.instrumentId());
  readonly addMappingHint = computed(() => this.context().addMappingHint
    || (this.showInstrumentPick() ? 'Pick the instrument above to add this to its mapping.' : 'Open the instrument to add this to its mapping.'));

  // ── Conversation ─────────────────────────────────────────────────────
  readonly items = signal<ChatItem[]>([]);
  readonly draft = signal('');
  readonly pending = signal(false);
  readonly added = signal<ReadonlySet<string>>(new Set());
  /** The month's PF Sense cap is used up: a calm notice instead of the starters, composer off. */
  readonly limitReached = this.sense.limitReached;
  protected readonly limitMessage = PF_SENSE_LIMIT_MESSAGE;
  /** A rate card is being prepared / uploaded / read: the composer waits. */
  readonly cardBusy = computed(() => this.items().some((i) => i.kind === 'card' && i.phase !== 'done' && i.phase !== 'error'));
  readonly canSend = computed(() => !this.limitReached() && !!this.draft().trim() && !this.pending() && !this.cardBusy() && !!this.provider() && this.providersState() === 'ready');
  readonly canAttach = computed(() => this.attachOn() && !this.limitReached() && !this.pending() && !this.cardBusy() && !!this.provider() && this.providersState() === 'ready');
  private seq = 0;
  private inFlight: Subscription | null = null;

  // ── This PC's network check (desktop) ────────────────────────────────
  readonly diagState = signal<DiagState>('none');
  private diagSnap: unknown = null;
  readonly diagPossible = computed(() => this.isInstruments() && (this.context().diag != null || this.bridge.diagAvailable));

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');
  private readonly filePick = viewChild<ElementRef<HTMLInputElement>>('filePick');
  private readonly camPick = viewChild<ElementRef<HTMLInputElement>>('camPick');

  constructor() {
    void this.beta.ensureLoaded();
    void this.sense.ensureLoaded();
    // First open: ask which models exist + take this PC's network check.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        if (this.providersState() === 'idle') this.loadProviders();
        if (this.diagState() === 'none' && this.isInstruments()) void this.attachDiag();
        setTimeout(() => this.composer()?.nativeElement.focus({ preventScroll: true }), 0);
      });
    });
    this.destroyRef.onDestroy(() => this.inFlight?.unsubscribe());
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.visible()) this.close(); }

  close() { this.closed.emit(); }

  loadProviders() {
    this.providersState.set('loading');
    this.providersError.set(null);
    this.api.providers().subscribe({
      next: (list) => {
        this.providers.set(list);
        this.provider.set(pickProvider(list, this.remembered()));
        this.providersState.set('ready');
      },
      error: (e) => {
        this.providersError.set(assistantError(e));
        this.providersState.set('error');
      },
    });
  }

  setProvider(id: string) {
    const p = this.providers().find((x) => x.id === id);
    if (!p?.available) return;
    this.provider.set(p.id);
    try { localStorage.setItem(PROVIDER_KEY, p.id); } catch { /* storage blocked */ }
  }

  private remembered(): string | null {
    try { return localStorage.getItem(PROVIDER_KEY); } catch { return null; }
  }

  // ── Network check chip ───────────────────────────────────────────────
  async attachDiag() {
    const given = this.context().diag;
    if (given != null) { this.diagSnap = given; this.diagState.set('attached'); return; }
    const d = this.bridge.diag;
    if (!d) { this.diagState.set('none'); return; }
    this.diagState.set('loading');
    try {
      const snap = await Promise.race([
        d.snapshot(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), DIAG_TIMEOUT_MS)),
      ]);
      this.diagSnap = snap;
      this.diagState.set('attached');
    } catch {
      this.diagSnap = null;
      this.diagState.set('failed');
    }
  }

  removeDiag() { this.diagState.set('removed'); }

  // ── Chat ─────────────────────────────────────────────────────────────
  ask(text: string) {
    this.draft.set(text);
    this.send();
  }

  send() {
    const text = this.draft().trim().slice(0, MAX_PROMPT_CHARS);
    if (!text || !this.canSend()) return;
    this.draft.set('');
    this.items.update((list) => [...list.filter((i) => i.kind !== 'error'), { id: ++this.seq, kind: 'user', text }]);
    this.request();
  }

  /** "Try again": the same conversation, without the error row. */
  retry() {
    if (this.pending()) return;
    this.items.update((list) => list.filter((i) => i.kind !== 'error'));
    this.request();
  }

  newChat() {
    this.inFlight?.unsubscribe();
    this.cardWork.clear();
    this.pending.set(false);
    this.items.set([]);
    this.added.set(new Set());
    setTimeout(() => this.composer()?.nativeElement.focus({ preventScroll: true }), 0);
  }

  private turns(): AssistantTurn[] {
    const out: AssistantTurn[] = [];
    for (const i of this.items()) {
      if (i.kind === 'user') out.push({ role: 'user', text: i.text });
      else if (i.kind === 'assistant') out.push({ role: 'assistant', text: i.text });
    }
    return historyFor(out);
  }

  private request() {
    const provider = this.provider();
    if (!provider) return;
    const label = this.providerLabel();
    this.pending.set(true);
    this.scrollToEnd();
    const diag = this.diagState() === 'attached' && this.diagSnap != null ? this.diagSnap : undefined;
    this.inFlight?.unsubscribe();
    const ctx = this.context();
    const call$ = ctx.chat
      ? ctx.chat({ provider, messages: this.turns() })
      : this.api.chat(ctx.page, {
        provider, instrumentId: this.instrumentId(), messages: this.turns(), ...(diag !== undefined ? { diag } : {}),
      });
    this.inFlight = call$.subscribe({
      next: (r) => {
        const text = r.reply.trim() || (r.suggestions.length ? '' : 'No answer came back. Try asking another way.');
        const by = this.providers().find((p) => p.id === r.provider)?.label ?? label;
        this.items.update((list) => [...list, {
          id: ++this.seq, kind: 'assistant', text, blocks: parseAssistantMarkdown(text), suggestions: r.suggestions, by,
        }]);
        this.pending.set(false);
        this.scrollToEnd();
      },
      error: (e) => {
        const view = assistantError(e, label);
        this.items.update((list) => [...list, { id: ++this.seq, kind: 'error', error: view }]);
        // An admin refusal changed the lab's PF Sense state: re-read so the page converges.
        if (view.kind === 'limit' || view.kind === 'off') void this.sense.refresh();
        this.pending.set(false);
        this.scrollToEnd();
      },
    });
  }

  // ── Rate card (Test Master) ──────────────────────────────────────────
  /** Per card: the prepared JPEG pages and, once stored, the upload id (so "Try again" never re-prepares or re-uploads). */
  private readonly cardWork = new Map<number, { blobs: Blob[]; uploadId: string | null; files: File[] }>();

  pickFile() { if (this.canAttach()) this.filePick()?.nativeElement.click(); }
  pickCamera() { if (this.canAttach()) this.camPick()?.nativeElement.click(); }

  onFilesPicked(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';   // the same file can be picked again
    if (files.length) void this.readCard(files);
  }

  private setCard(id: number, patch: Partial<Extract<ChatItem, { kind: 'card' }>>) {
    this.items.update((list) => list.map((i) => (i.id === id && i.kind === 'card' ? { ...i, ...patch } : i)));
  }

  async readCard(files: File[], resume?: number) {
    const provider = this.provider();
    if (!provider || !this.canAttach() && resume === undefined) return;
    const id = resume ?? ++this.seq;
    if (resume === undefined) {
      this.items.update((list) => [...list.filter((i) => i.kind !== 'error'), { id, kind: 'card', phase: 'preparing', step: 'Getting the pages ready…', summary: null, error: null, canRetry: false }]);
      this.cardWork.set(id, { blobs: [], uploadId: null, files });
    } else {
      this.setCard(id, { phase: 'reading', step: 'Cortex is reading the rate card…', error: null, canRetry: false });
    }
    this.scrollToEnd();
    const work = this.cardWork.get(id)!;
    try {
      if (!work.blobs.length) {
        work.blobs = await this.prepare(work.files, (p) => this.setCard(id, { step: p.total > 1 ? `Getting page ${Math.min(p.done + 1, p.total)} of ${p.total} ready…` : 'Getting the page ready…' }));
      }
      if (!work.uploadId) {
        this.setCard(id, { phase: 'uploading', step: `Sending ${work.blobs.length} page${work.blobs.length === 1 ? '' : 's'}…` });
        work.uploadId = (await firstValueFrom(this.api.rateCardUpload(work.blobs))).uploadId;
      }
      this.setCard(id, { phase: 'reading', step: `Cortex is reading ${work.blobs.length} page${work.blobs.length === 1 ? '' : 's'}…` });
      this.scrollToEnd();
      const summary = await firstValueFrom(this.api.rateCardRead(work.uploadId, provider));
      this.cardWork.delete(id);
      this.setCard(id, { phase: 'done', step: '', summary });
      if (summary.suggestions > 0) void this.sense.refresh();
    } catch (e) {
      const view = e instanceof RateCardPrepareException
        ? { kind: 'invalid', retry: false, message: PREPARE_WORDS[e.code] } as AssistantErrorView
        : this.cardError(e);
      // A prepare / upload failure can be retried from the stored files; a refused read (cap / off / already read) cannot.
      this.setCard(id, { phase: 'error', step: '', error: view, canRetry: view.retry && !(e instanceof RateCardPrepareException) });
      if (view.kind === 'limit' || view.kind === 'off') void this.sense.refresh();
    }
    this.scrollToEnd();
  }

  private cardError(e: unknown): AssistantErrorView {
    const body = (e as { error?: { error?: string } })?.error;
    if (body?.error === 'not_found' || (e as { status?: number })?.status === 404 && !body?.error) {
      return { kind: 'missing', retry: false, message: 'That rate card isn’t there any more. Add it again.' };
    }
    return assistantError(e, this.providerLabel());
  }

  retryCard(id: number) {
    const w = this.cardWork.get(id);
    if (w && !this.cardBusy()) void this.readCard(w.files, id);
  }

  reviewInPending(batch: string | null) { this.openPending.emit(batch); }

  /** Proposals Cortex saved in one chat answer (for the "Review in Pending" link under it). */
  proposalCount(item: ChatItem): number {
    return item.kind === 'assistant' ? item.suggestions.filter((s) => s.kind === 'proposal').length : 0;
  }

  onComposerKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      this.send();
    }
  }

  private scrollToEnd() {
    setTimeout(() => {
      const el = this.thread()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  // ── Suggestion actions ───────────────────────────────────────────────
  async copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.toasts.success('Copied');
    } catch {
      this.toasts.error('Copy failed — select the value and copy it');
    }
  }

  addedKey(item: ChatItem, s: MappingSuggestion, t: AssistantTestRef): string {
    return `${item.id}|${s.analyzerCode}|${t.testId || t.code}`;
  }

  isAdded(item: ChatItem, s: MappingSuggestion, t: AssistantTestRef): boolean {
    return this.added().has(this.addedKey(item, s, t));
  }

  addToMapping(item: ChatItem, s: MappingSuggestion, t: AssistantTestRef) {
    if (!this.canAddMapping()) return;
    this.addMapping.emit({
      instrumentId: this.instrumentId(), analyzerCode: s.analyzerCode, unit: s.unit ?? null,
      testId: t.testId || null, testCode: t.code || null, testName: t.name || null,
    });
    this.added.update((set) => new Set([...set, this.addedKey(item, s, t)]));
  }

  // ── Host proposals (Insights: Keep / Undo a previewed recipe) ────────
  proposalStatus(s: ChangesSuggestion): ProposalStatus {
    return this.context().proposals?.[s.ref] ?? 'replaced';
  }

  keep(s: ChangesSuggestion) { if (this.proposalStatus(s) === 'pending') this.keepProposal.emit(s.ref); }
  undo(s: ChangesSuggestion) { if (this.proposalStatus(s) === 'pending') this.undoProposal.emit(s.ref); }

  confWord(s: AssistantSuggestion): string { return s.kind === 'mapping' ? CONFIDENCE_WORDS[s.confidence] ?? '' : ''; }
}
