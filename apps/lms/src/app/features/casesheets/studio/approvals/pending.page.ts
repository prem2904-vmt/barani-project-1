import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Answers, FE_KINDS, KIND_SPECS, PfIconComponent } from '@prefrontal/forms-engine';
import { PfSelectOption, SegmentedComponent, SegmentedOption, SelectComponent, SkeletonRowsComponent } from '@prefrontal/shared';
import { AuthService } from '../../../../core/auth/auth.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { casesheetLinks } from '../../casesheets.routes';
import { CsStylesComponent } from '../../styles/cs-styles.component';
import { mediaSignal } from '../shared/desk';
import { whenText } from '../shared/when';
import { CaseSheetApprovalsApi } from './approvals-api';
import {
  OfferView, ProposalFilter, ProposalStatus, ProposalView, STATUS_LABEL, approvalWords, errorCode, failedWords, groupChanges, isOpen,
  kindLabel, openTotal, sourceLine, statusTone, waitingWords,
} from './approvals-models';
import { PendingCountService } from './pending-count.service';
import { SheetRenderComponent, changedKeys } from './sheet-render.component';

export type PendingTab = 'suggested' | 'prefrontal';
type Busy = 'approve' | 'reject' | 'rereview' | 'withdraw' | 'accept' | 'dismiss' | null;

/**
 * Settings → IPD → Case sheets → Pending changes (`casesheet_forms_manage`, behind the case-sheet gate like every Studio page).
 *  - "Suggested": changes Cortex or a connected app suggested. Open one → the case sheet as it is now next to the suggestion, both
 *    drawn by the real forms engine, the plain-words change list and the option checks (failures only warn). ONE at a time:
 *    Approve (publishes straight away — the confirm says so), Reject (optional note), Look again for a stale / failed one.
 *    There is no approve-all, here or on the server.
 *  - "From Prefrontal": newer versions of Prefrontal's case sheets the lab has its own copy of: what is different, then
 *    "Take Prefrontal's version" or "Keep mine".
 * Query params: `tab`, `id` (a suggestion), `offer` (an update). Phones: the list, then one item full screen.
 */
@Component({
  selector: 'app-studio-pending',
  standalone: true,
  imports: [HeroBandComponent, PfIconComponent, SkeletonRowsComponent, SegmentedComponent, SelectComponent, RouterLink, SheetRenderComponent, CsStylesComponent],
  providers: [{ provide: FE_KINDS, useValue: KIND_SPECS }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pending.page.html',
  styleUrls: ['../shared/page.scss', '../studio.page.scss', './pending.page.scss'],
})
export class StudioPendingPage {
  /** ?tab=suggested|prefrontal */
  readonly tab = input<string | undefined>();
  /** ?id=<suggestion> */
  readonly id = input<string | undefined>();
  /** ?offer=<update> */
  readonly offer = input<string | undefined>();

  private readonly api = inject(CaseSheetApprovalsApi);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  protected readonly count = inject(PendingCountService);
  protected readonly links = casesheetLinks;

  protected readonly wide = mediaSignal('(min-width: 1024px)');
  protected readonly when = whenText;
  protected readonly statusLabel = (s: ProposalStatus) => STATUS_LABEL[s];
  protected readonly tone = statusTone;
  protected readonly kindLabel = kindLabel;
  protected readonly sourceLine = sourceLine;
  protected readonly failedWords = failedWords;

  // ---------------- list ----------------
  protected readonly activeTab = computed<PendingTab>(() => (this.tab() === 'prefrontal' ? 'prefrontal' : 'suggested'));
  protected readonly filter = signal<ProposalFilter>('open');
  protected readonly items = signal<ProposalView[] | null>(null);
  protected readonly total = signal(0);
  protected readonly offers = signal<OfferView[] | null>(null);
  protected readonly listError = signal('');

  protected readonly filterOptions: PfSelectOption<ProposalFilter>[] = [
    { value: 'open', label: 'Waiting' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'withdrawn', label: 'Taken back' },
    { value: 'all', label: 'All' },
  ];
  protected readonly tabs = computed<SegmentedOption<PendingTab>[]>(() => [
    { value: 'suggested', label: 'Suggested', count: this.count.waiting() || null },
    { value: 'prefrontal', label: 'From Prefrontal', count: this.count.offers().length || null },
  ]);
  protected readonly waitingLabel = computed(() => waitingWords(openTotal(this.count.counts(), this.count.offers().length)));

  // ---------------- one item ----------------
  protected readonly view = computed<'list' | 'suggestion' | 'offer'>(() => (this.id() ? 'suggestion' : this.offer() ? 'offer' : 'list'));
  protected readonly detail = signal<ProposalView | null>(null);
  protected readonly detailError = signal('');
  protected readonly busy = signal<Busy>(null);
  /** The last action's refusal, in plain words, shown beside the buttons. */
  protected readonly actionError = signal('');
  /** One set of scratch answers for both sides of the before / after. */
  protected readonly answers = signal<Answers>({});
  protected readonly setAnswer = (key: string, value: unknown): void => this.answers.update((a) => ({ ...a, [key]: value }));
  /** Phones / tablets: one card at a time. */
  protected readonly pane = signal<'review' | 'compare'>('review');
  protected readonly panes: SegmentedOption<'review' | 'compare'>[] = [
    { value: 'review', label: 'Review' },
    { value: 'compare', label: 'Before and after' },
  ];

  protected readonly groups = computed(() => groupChanges(this.detail()?.detail?.changes ?? []));
  protected readonly before = computed(() => this.detail()?.detail?.current?.definition ?? null);
  protected readonly after = computed(() => this.detail()?.detail?.proposed ?? null);
  protected readonly markedBefore = computed(() => changedKeys(this.detail()?.detail?.changes ?? [], 'before'));
  protected readonly markedAfter = computed(() => changedKeys(this.detail()?.detail?.changes ?? [], 'after'));
  protected readonly failing = computed(() => (this.detail()?.detail?.checks.checks ?? []).filter((c) => c.result && !c.result.pass));
  protected readonly errors = computed(() => (this.detail()?.detail?.problems ?? []).filter((p) => p.severity === 'error'));
  protected readonly warnings = computed(() => (this.detail()?.detail?.problems ?? []).filter((p) => p.severity !== 'error'));
  protected readonly mine = computed(() => {
    const me = this.auth.user()?.id;
    return !!me && this.detail()?.proposedBy === me;
  });
  /** Approve is offered only for a pending one the server says is publishable. */
  protected readonly canApprove = computed(() => {
    const p = this.detail();
    return !!p && p.status === 'pending' && !!p.detail?.canApprove;
  });
  protected readonly needsLook = computed(() => {
    const s = this.detail()?.status;
    return s === 'stale' || s === 'failed';
  });
  protected readonly decided = computed(() => {
    const s = this.detail()?.status;
    return !!s && !isOpen(s) && s !== 'building';
  });

  protected readonly theOffer = computed(() => (this.offers() ?? []).find((o) => o.id === this.offer()) ?? null);
  protected readonly offerGroups = computed(() => groupChanges(this.theOffer()?.changes ?? []));
  protected readonly offerDecided = signal<OfferView | null>(null);

  protected readonly backFn = () => this.toList();

  constructor() {
    void this.count.refresh();
    effect(() => {
      const t = this.activeTab();
      const f = this.filter();
      untracked(() => void (t === 'prefrontal' ? this.loadOffers() : this.loadList(f)));
    });
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.detail.set(null);
        this.detailError.set('');
        this.actionError.set('');
        this.answers.set({});
        this.pane.set('review');
        if (id) void this.loadDetail(id);
      });
    });
    effect(() => {
      const o = this.offer();
      untracked(() => {
        this.actionError.set('');
        this.offerDecided.set(null);
        if (o && this.offers() === null) void this.loadOffers();
      });
    });
  }

  // ---------------- loading ----------------

  async loadList(f: ProposalFilter = this.filter()): Promise<void> {
    this.listError.set('');
    try {
      const page = await this.api.list({ status: f, take: 100 });
      this.items.set(page.items);
      this.total.set(page.total);
      this.count.counts.set(page.counts);
    } catch (e) {
      this.items.set(this.items() ?? []);
      this.listError.set(approvalWords(e, 'Can’t load the suggestions right now.'));
    }
  }

  async loadOffers(): Promise<void> {
    this.listError.set('');
    try {
      const list = await this.api.offers();
      this.offers.set(list);
      this.count.offers.set(list);
    } catch (e) {
      this.offers.set(this.offers() ?? []);
      this.listError.set(approvalWords(e, 'Can’t load the updates from Prefrontal right now.'));
    }
  }

  private async loadDetail(id: string): Promise<void> {
    try {
      const p = await this.api.get(id);
      if (this.id() === id) this.detail.set(p);
    } catch (e) {
      if (this.id() === id) this.detailError.set(approvalWords(e, 'Can’t open this suggestion right now.'));
    }
  }

  // ---------------- navigation ----------------

  protected setTab(t: PendingTab): void {
    void this.router.navigate([casesheetLinks.adminPending()], { queryParams: { tab: t === 'prefrontal' ? 'prefrontal' : null } });
  }

  protected open(p: ProposalView): void {
    void this.router.navigate([casesheetLinks.adminPending()], { queryParams: { id: p.id } });
  }

  protected openOffer(o: OfferView): void {
    void this.router.navigate([casesheetLinks.adminPending()], { queryParams: { tab: 'prefrontal', offer: o.id } });
  }

  protected toList(): void {
    void this.router.navigate([casesheetLinks.adminPending()], { queryParams: { tab: this.view() === 'offer' ? 'prefrontal' : null } });
  }

  // ---------------- one suggestion ----------------

  private async after_(p: ProposalView, done: string): Promise<void> {
    this.toasts.success(done);
    // the decision response has no before / after: read the suggestion again so the screen shows where it stands now
    await this.loadDetail(p.id);
    void this.count.refresh();
    void this.loadList();
  }

  /** Approve = publish now, as me (the confirm says so). One at a time. */
  async approve(): Promise<void> {
    const p = this.detail();
    if (!p || !this.canApprove() || this.busy()) return;
    const fails = this.failing();
    const what =
      p.kind === 'create'
        ? `This makes the new case sheet “${p.title}” and publishes it straight away.`
        : p.sharedMaster
          ? `This makes your lab’s own copy of Prefrontal’s “${p.title}” and publishes it straight away.`
          : `This publishes the suggestion straight away as the new live version of “${p.title}”.`;
    const ok = await this.dialog.confirm({
      title: 'Approve and publish?',
      message: `${what} Doctors get it on the next case sheet they start; sheets already started keep their version.`,
      items: fails.length ? fails.map((c) => `Check fails: ${c.title}`) : undefined,
      question: fails.length ? (fails.length === 1 ? '1 check fails. Checks only warn, so you can still approve.' : `${fails.length} checks fail. Checks only warn, so you can still approve.`) : undefined,
      confirmLabel: 'Approve and publish',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    this.busy.set('approve');
    this.actionError.set('');
    try {
      await this.api.approve(p.id);
      await this.after_(p, `Published “${p.title}”`);
    } catch (e) {
      this.actionError.set(approvalWords(e, 'Couldn’t publish it just now. Please try again.'));
      // stale (changed since) or failed: the row moved — show where it stands now
      if (['changed_since_proposed', 'not_pending', 'someone_else_saved'].includes(errorCode(e)) || (e as { status?: number })?.status === 409) {
        await this.loadDetail(p.id);
        void this.count.refresh();
      }
    } finally {
      this.busy.set(null);
    }
  }

  async reject(): Promise<void> {
    const p = this.detail();
    if (!p || !isOpen(p.status) || this.busy()) return;
    const note = await this.dialog.prompt({
      title: 'Reject this suggestion?',
      message: 'Nothing changes in the case sheet. You can add a note for whoever asked for it.',
      placeholder: 'Note (optional)',
      multiline: true,
      confirmLabel: 'Reject',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (note === null) return;
    this.busy.set('reject');
    this.actionError.set('');
    try {
      await this.api.reject(p.id, note);
      await this.after_(p, 'Suggestion rejected');
    } catch (e) {
      this.actionError.set(approvalWords(e));
      if (errorCode(e) === 'not_pending') await this.loadDetail(p.id);
    } finally {
      this.busy.set(null);
    }
  }

  /** "Look again": compare the suggestion with the case sheet as it is today (no merge). */
  async lookAgain(): Promise<void> {
    const p = this.detail();
    if (!p || !this.needsLook() || this.busy()) return;
    this.busy.set('rereview');
    this.actionError.set('');
    try {
      await this.api.reReview(p.id);
      await this.after_(p, 'Now compared with today’s version');
    } catch (e) {
      this.actionError.set(approvalWords(e));
    } finally {
      this.busy.set(null);
    }
  }

  /** The proposer takes their own suggestion back. */
  async withdraw(): Promise<void> {
    const p = this.detail();
    if (!p || !this.mine() || this.busy() || !(isOpen(p.status) || p.status === 'building')) return;
    const ok = await this.dialog.confirm({
      title: 'Take this suggestion back?',
      message: 'It leaves Pending changes and nothing changes in the case sheet.',
      confirmLabel: 'Take it back',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    this.busy.set('withdraw');
    this.actionError.set('');
    try {
      await this.api.withdraw(p.id);
      await this.after_(p, 'Suggestion taken back');
    } catch (e) {
      this.actionError.set(approvalWords(e));
    } finally {
      this.busy.set(null);
    }
  }

  // ---------------- one update from Prefrontal ----------------

  async acceptOffer(): Promise<void> {
    const o = this.theOffer();
    if (!o || this.busy()) return;
    const ok = await this.dialog.confirm({
      title: 'Take Prefrontal’s version?',
      message: `Your copy of “${o.title}” publishes Prefrontal’s version ${o.masterVersionNo} straight away as its new live version. Your earlier versions stay in Version history.`,
      confirmLabel: 'Take Prefrontal’s version',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    this.busy.set('accept');
    this.actionError.set('');
    try {
      const r = await this.api.acceptOffer(o.id);
      this.offerDecided.set({ ...o, ...r, changes: o.changes, headline: o.headline });
      this.toasts.success(`Your copy of “${o.title}” now has Prefrontal’s version`);
      await this.loadOffers();
    } catch (e) {
      this.actionError.set(approvalWords(e, 'Couldn’t take Prefrontal’s version just now. Please try again.'));
      if (errorCode(e) === 'offer_outdated' || errorCode(e) === 'not_pending') await this.loadOffers();
    } finally {
      this.busy.set(null);
    }
  }

  async keepMine(): Promise<void> {
    const o = this.theOffer();
    if (!o || this.busy()) return;
    const ok = await this.dialog.confirm({
      title: 'Keep your version?',
      message: `Your copy of “${o.title}” stays as it is. Prefrontal’s version ${o.masterVersionNo} won’t be offered again; a later version will be.`,
      confirmLabel: 'Keep mine',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    this.busy.set('dismiss');
    this.actionError.set('');
    try {
      const r = await this.api.dismissOffer(o.id);
      this.offerDecided.set({ ...o, ...r, changes: o.changes, headline: o.headline });
      this.toasts.success('Kept your version');
      await this.loadOffers();
    } catch (e) {
      this.actionError.set(approvalWords(e));
      if (errorCode(e) === 'offer_outdated' || errorCode(e) === 'not_pending') await this.loadOffers();
    } finally {
      this.busy.set(null);
    }
  }

  /** The offer on screen: the live one, or the one just decided (it leaves the pending list). */
  protected readonly shownOffer = computed(() => this.theOffer() ?? (this.offerDecided()?.id === this.offer() ? this.offerDecided() : null));

  protected offerLine(o: OfferView): string {
    const yours = o.yourBasisVersionNo ? `Your copy started from version ${o.yourBasisVersionNo}` : 'Your own copy';
    return `${yours} · Prefrontal’s version ${o.masterVersionNo}${o.masterPublishedAt ? ', published ' + whenText(o.masterPublishedAt) : ''}`;
  }

  protected firstLine(p: ProposalView): string {
    return p.summary[0] ?? (p.kind === 'create' ? 'A new case sheet' : 'Changes to this case sheet');
  }
}
