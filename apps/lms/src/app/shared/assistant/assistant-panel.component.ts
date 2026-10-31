import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { PfSenseService } from '../../core/services/pf-sense.service';
import { ToastService } from '../../core/services/toast.service';
import { SelectComponent, PfSelectOption } from '../primitives/select.component';
import { InstrumentBridgeService } from '../instruments/instrument-bridge.service';
import { AssistantApiService } from './assistant-api.service';
import {
  AssistantErrorView, CONFIDENCE_WORDS, MAX_PROMPT_CHARS, PF_SENSE_LIMIT_MESSAGE, assistantError, historyFor, mappingCodeLabel, mappingTestLabel,
  pickProvider, providerOptions,
} from './assistant-logic';
import { MdBlock, parseAssistantMarkdown } from './assistant-markdown';
import {
  ASSISTANT_COPY, ASSISTANT_STARTERS, ASSISTANT_TITLES, AssistantPageContext, AssistantProvider, AssistantProviderId, AssistantSuggestion,
  AssistantTestRef, AssistantTurn, ChangesSuggestion, MappingPrefill, MappingSuggestion, ProposalStatus,
} from './assistant.models';

/** One row of the conversation. */
export type ChatItem =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string; blocks: MdBlock[]; suggestions: AssistantSuggestion[]; by: string }
  | { id: number; kind: 'error'; error: AssistantErrorView };

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
 * a full-screen sheet on phones. Model pf-select (unavailable greyed),
 * starter prompts, the chat (model text rendered as TEXT tokens — never
 * HTML), suggestion cards (setting + Copy, action, mapping + Add to mapping),
 * this PC's network check as a removable chip (desktop app only).
 */
@Component({
  selector: 'pf-assistant-panel',
  standalone: true,
  imports: [SelectComponent, NgTemplateOutlet],
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

  readonly open = input(false);
  readonly context = input.required<AssistantPageContext>();
  readonly closed = output<void>();
  readonly addMapping = output<MappingPrefill>();
  readonly keepProposal = output<string>();
  readonly undoProposal = output<string>();
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

  // ── Models ───────────────────────────────────────────────────────────
  readonly providers = signal<AssistantProvider[]>([]);
  readonly providersState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly providersError = signal<AssistantErrorView | null>(null);
  readonly provider = signal<AssistantProviderId | null>(null);
  readonly providerOpts = computed(() => providerOptions(this.providers()));
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
  readonly canSend = computed(() => !this.limitReached() && !!this.draft().trim() && !this.pending() && !!this.provider() && this.providersState() === 'ready');
  private seq = 0;
  private inFlight: Subscription | null = null;

  // ── This PC's network check (desktop) ────────────────────────────────
  readonly diagState = signal<DiagState>('none');
  private diagSnap: unknown = null;
  readonly diagPossible = computed(() => this.isInstruments() && (this.context().diag != null || this.bridge.diagAvailable));

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

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

  setProvider(id: AssistantProviderId) {
    const p = this.providers().find((x) => x.id === id);
    if (!p?.available) return;
    this.provider.set(id);
    try { localStorage.setItem(PROVIDER_KEY, id); } catch { /* storage blocked */ }
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
