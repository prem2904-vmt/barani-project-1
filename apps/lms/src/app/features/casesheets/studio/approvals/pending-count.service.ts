import { Injectable, computed, inject, signal } from '@angular/core';
import { CaseSheetApprovalsApi } from './approvals-api';
import { OfferView, ProposalCounts, ProposalView, openTotal } from './approvals-models';

/**
 * What waits for a person, for the badges the lab notices (Settings → IPD → Case sheets tile, the Case sheets list header and
 * its rows). ONE read of the inbox (open suggestions, newest 100) + the Prefrontal offers; a refusal (gate closed, no
 * permission, offline) simply shows no badge. The inbox page calls {@link refresh} after every decision.
 */
@Injectable({ providedIn: 'root' })
export class PendingCountService {
  private readonly api = inject(CaseSheetApprovalsApi);
  private loading: Promise<void> | null = null;

  readonly counts = signal<ProposalCounts | null>(null);
  readonly suggestions = signal<ProposalView[]>([]);
  readonly offers = signal<OfferView[]>([]);
  /** Suggestions waiting (pending + stale + failed, for the whole lab). */
  readonly waiting = computed(() => openTotal(this.counts()));
  /** Everything waiting: suggestions + Prefrontal updates. */
  readonly total = computed(() => openTotal(this.counts(), this.offers().length));

  /** Open suggestions per case sheet id (a create has no case sheet yet, so it is not listed here). */
  readonly byForm = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.suggestions()) if (p.formId) m.set(p.formId, (m.get(p.formId) ?? 0) + 1);
    return m;
  });
  /** Case sheet ids (the lab's own copies) with a Prefrontal update waiting. */
  readonly offerForms = computed(() => new Set(this.offers().map((o) => o.formId)));

  /** Read again (shared by callers that ask at the same moment). Never throws. */
  refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const [page, offers] = await Promise.all([
        this.api.list({ status: 'open', take: 100 }).catch(() => null),
        this.api.offers().catch(() => null),
      ]);
      if (page) {
        this.counts.set(page.counts);
        this.suggestions.set(page.items.filter((p) => p.status !== 'building'));
      }
      if (offers) this.offers.set(offers);
    })().finally(() => (this.loading = null));
    return this.loading;
  }
}
