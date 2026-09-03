import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { CultureEntryComponent } from '../culture-entry/culture-entry.component';
import { DelegateModalComponent } from '../my-work/delegate-modal.component';
import { CultureResult } from '../../../shared/models/culture.model';
import { CultureCaseView, CultureStageView } from '../culture-panel/culture-panel.component';

/**
 * The CULTURE bench workspace for one case — the staged pipeline
 * (Gram → Growth → Identification → AST) with the per-stage soft lock. Any
 * micro tech can pick an open stage; once picked it's locked to them until they
 * submit, drop, or delegate it, and others can work a different stage in
 * parallel. Every completed stage is stamped who + when.
 *
 * v1 captures each stage's finding as free text (the rich per-stage editors —
 * Gram option groups, the existing culture-entry AST table — layer on later).
 * When the bench is done, "Submit for sign-out" hands the case to a pathologist.
 */
@Component({
  selector: 'pf-culture-workbench',
  standalone: true,
  imports: [FormsModule, CultureEntryComponent, DelegateModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="pf-cse__note">Loading…</div>
    } @else if (!c()) {
      <div class="pf-cse__note">Case not found.</div>
    } @else if (c(); as cc) {
      <!-- ── Whole case, result-entry style: every stage a row, worked
           collaboratively (lock per stage, pick inline, notes autosave). ── -->
      <section class="pf-cse">
        <header class="pf-cse__hdr">
          <button type="button" class="pf-cse__back" (click)="back()" aria-label="Back">‹</button>
          <div class="pf-cse__titles">
            <div class="pf-cse__eyebrow">{{ (cc.departmentName || 'Microbiology') }} · Culture &amp; Sensitivity</div>
            <div class="pf-cse__id">{{ cc.barcode || cc.sampleId || '—' }}</div>
            <div class="pf-cse__patient">{{ cc.patientName || '—' }}<span class="pf-cse__mid">·</span>{{ cc.testName || 'Culture' }}</div>
          </div>
          @if (cc.caseState === 'awaiting_signout') {
            <span class="pf-cse__awaitpill">Awaiting sign-out</span>
          } @else if (allDone()) {
            <button type="button" class="pf-cse__signout" [disabled]="busy()" (click)="submitForSignout()">Submit for sign-out</button>
          }
        </header>

        <div class="pf-cse__scroll">
          <div class="pf-cse__grid-wrap">
            <table class="pf-cse__grid">
              <thead><tr><th class="pf-cse__th pf-cse__th--param">Stage</th><th class="pf-cse__th">Result</th></tr></thead>
              <tbody>
                @for (s of cc.stages; track s.key) {
                  <tr class="pf-cse__row" [class.pf-cse__row--locked]="lockedByOther(s)">
                    <td class="pf-cse__param">
                      <span class="pf-cse__pname">{{ s.label }}</span>
                      @if (s.state === 'done') { <span class="pf-cse__badge pf-cse__badge--done">Done{{ s.doneByName ? ' · ' + s.doneByName : '' }}</span> }
                      @else if (isMine(s)) { <span class="pf-cse__badge pf-cse__badge--mine">You{{ elapsed(s) ? ' · ' + elapsed(s) : '' }}</span> }
                      @else if (s.state === 'picked') { <span class="pf-cse__badge pf-cse__badge--held">{{ s.holderName || 'in progress' }}{{ elapsed(s) ? ' · ' + elapsed(s) : '' }}</span> }
                      @else if (incubating(s)) { <span class="pf-cse__badge pf-cse__badge--incub">Incubating</span> }
                    </td>
                    <td class="pf-cse__cell">
                      @if (s.state === 'done') {
                        <span class="pf-cse__done">✓ {{ readable(s.valuesJson || '') || 'Completed' }}</span>
                      } @else if (isMine(s)) {
                        @if (s.key === 'ast') {
                          <button type="button" class="pf-cse__astbtn" (click)="astOpen.set(!astOpen())">
                            {{ astOpen() ? 'Hide organism / sensitivity ▴' : ((astSummary() || 'Enter organism + sensitivity') + ' ▾') }}
                          </button>
                        } @else {
                          <textarea class="pf-cse__input" rows="2" [ngModel]="drafts()[s.key] || ''"
                                    (ngModelChange)="onDraft(s.key, $event)" placeholder="Enter findings…"></textarea>
                        }
                        <div class="pf-cse__rowact">
                          <button type="button" class="pf-cse__ghost pf-cse__ghost--sm" [disabled]="busy()" (click)="drop(s)">Drop</button>
                          <button type="button" class="pf-cse__ghost pf-cse__ghost--sm" [disabled]="busy()" (click)="startDelegate(s)">Delegate</button>
                          <button type="button" class="pf-cse__go" [disabled]="busy()" (click)="submit(s)">Submit</button>
                        </div>
                      } @else if (s.state === 'picked') {
                        <span class="pf-cse__lockmsg">🔒 In progress · {{ s.holderName || 'another tech' }}</span>
                      } @else if (incubating(s)) {
                        <span class="pf-cse__incub">⏳ Incubating — ready in {{ incubateReadyIn(s) }}</span>
                      } @else {
                        <div class="pf-cse__rowact">
                          @if (requiresIncubation(s.key)) {
                            <button type="button" class="pf-cse__ghost pf-cse__ghost--sm" [disabled]="busy()" (click)="incubate(s)">Inoculate &amp; incubate</button>
                          }
                          <button type="button" class="pf-cse__pick" [disabled]="busy()" (click)="pick(s)">Pick up</button>
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (astStage(); as ast) {
            @if (isMine(ast) && astOpen()) {
              <div class="pf-cse__astwrap">
                <pf-culture-entry [value]="astValue()" [organismNames]="organismNames()"
                                  (valueChange)="astValue.set($event)"></pf-culture-entry>
              </div>
            }
          }
        </div>
      </section>
    }

    @if (delegating(); as ds) {
      <pf-delegate-modal [testName]="ds.label" (chose)="doDelegate(ds, $event)" (cancelled)="delegating.set(null)"></pf-delegate-modal>
    }
  `,
  styles: [`
    .pf-cse__note { padding: 48px; text-align: center; font-size: 13px; color: var(--text-tertiary); }
    /* Single-stage entry — mirrors the standard result-entry chrome. */
    .pf-cse { display: flex; flex-direction: column; min-height: calc(100dvh - 60px); }
    .pf-cse__hdr { position: sticky; top: 0; z-index: 5; display: flex; align-items: flex-start; gap: 12px;
      padding: 16px 24px; background: var(--bg-card, #12121a); border-bottom: 1px solid var(--glass-border); }
    .pf-cse__back { flex-shrink: 0; font-size: 22px; line-height: 1; background: transparent; border: none;
      color: var(--text-secondary); cursor: pointer; padding: 2px 6px; }
    .pf-cse__titles { flex: 1; min-width: 0; }
    .pf-cse__eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-cse__id { font-size: 26px; font-weight: 800; color: var(--text-primary); margin-top: 2px; font-variant-numeric: tabular-nums; }
    .pf-cse__patient { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
    .pf-cse__mid { margin: 0 6px; opacity: .6; }
    .pf-cse__tech { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 12.5px; font-weight: 600;
      color: var(--text-secondary); padding: 6px 12px; border-radius: 999px; background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cse__tech-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
    .pf-cse__held { font-weight: 500; opacity: .8; }

    .pf-cse__awaitpill { flex-shrink: 0; font-size: 12px; font-weight: 700; color: #b45309;
      padding: 6px 12px; border-radius: 999px; background: rgba(245,158,11,0.14); }
    .pf-cse__signout { flex-shrink: 0; padding: 9px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; color: #fff;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; cursor: pointer; }
    .pf-cse__signout:disabled { opacity: .5; cursor: default; }

    .pf-cse__scroll { flex: 1; padding: 22px 24px 60px; }
    .pf-cse__grid-wrap { border: 1px solid var(--glass-border); border-radius: 12px; overflow: hidden; }
    .pf-cse__grid { width: 100%; border-collapse: collapse; }
    .pf-cse__th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-tertiary); padding: 13px 18px; background: rgba(124,58,237,0.09); border-bottom: 1px solid var(--glass-border); }
    .pf-cse__th--param { width: 32%; }
    .pf-cse__row td { border-bottom: 1px solid var(--glass-border); vertical-align: top; }
    .pf-cse__row:last-child td { border-bottom: none; }
    /* Another tech holds this stage → grayed out, non-interactive. */
    .pf-cse__row--locked { opacity: .55; }
    .pf-cse__param { padding: 16px 18px; }
    .pf-cse__pname { display: block; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-cse__badge { display: inline-block; margin-top: 5px; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
    .pf-cse__badge--done { color: #15803d; background: rgba(34,197,94,0.14); }
    .pf-cse__badge--mine { color: #7c3aed; background: rgba(124,58,237,0.16); }
    .pf-cse__badge--held { color: #b45309; background: rgba(245,158,11,0.16); }
    .pf-cse__badge--incub { color: #0e7490; background: rgba(6,182,212,0.16); }
    .pf-cse__incub { font-size: 12.5px; font-weight: 600; color: #0e7490; }
    .pf-cse__cell { padding: 12px 18px; }
    .pf-cse__done { color: #15803d; font-weight: 600; font-size: 13px; }
    .pf-cse__lockmsg { font-size: 12.5px; font-weight: 600; color: var(--text-tertiary); }
    .pf-cse__input { width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 13.5px; color: var(--text-primary);
      background: var(--input-bg); border: 1px solid var(--input-border); outline: none; resize: vertical; box-sizing: border-box; }
    .pf-cse__input:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,.18); }
    .pf-cse__astbtn { font-size: 13px; font-weight: 600; color: var(--violet-text, #7c3aed); background: transparent;
      border: 1px dashed rgba(124,58,237,.4); border-radius: 8px; padding: 9px 12px; cursor: pointer; width: 100%; text-align: left; }
    .pf-cse__pick { font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer; padding: 8px 16px; border-radius: 9px;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-cse__pick:disabled { opacity: .5; cursor: default; }
    .pf-cse__rowact { display: flex; gap: 8px; margin-top: 8px; }
    .pf-cse__ghost { border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cse__ghost--sm { padding: 6px 12px; }
    .pf-cse__ghost:disabled { opacity: .5; cursor: default; }
    .pf-cse__go { margin-left: auto; padding: 6px 18px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-cse__go:disabled { opacity: .5; cursor: default; }
    .pf-cse__astwrap { margin-top: 18px; padding-top: 6px; }
  `],
})
export class CultureWorkbenchComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  readonly c = signal<CultureCaseView | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  /** Per-stage draft notes (autosaved to localStorage), keyed by stage key. */
  readonly drafts = signal<Record<string, string>>({});
  /** The AST stage's structured result (organisms + S/I/R). */
  readonly astValue = signal<CultureResult>({});
  /** Whether the AST organism/sensitivity editor is expanded. */
  readonly astOpen = signal(false);
  /** Master-driven organism names for the AST editor's picker. */
  readonly organismNames = signal<string[]>([]);
  /** Ticks every 30s so per-stage "held" timers update live. */
  private readonly now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  private id = '';

  /** The stage the tech came in to work (from ?stage=…) — the entry focuses on
   *  just this one, styled like the standard result-entry. Null = full case. */
  readonly focusStage = signal<string | null>(null);

  readonly subtitle = computed(() => {
    const c = this.c();
    if (!c) return '';
    return [c.patientName, c.testName, c.departmentName].filter(Boolean).join(' · ');
  });

  /** Only the focused stage when one was picked; otherwise the whole case. */
  readonly visibleStages = computed(() => {
    const all = this.c()?.stages ?? [];
    const key = this.focusStage();
    if (!key) return all;
    const one = all.filter(s => s.key === key);
    return one.length ? one : all;
  });

  readonly eyebrow = computed(() => {
    const s = this.visibleStages();
    return this.focusStage() && s.length === 1 ? `Culture · ${s[0].label}` : 'Microbiology · Culture';
  });

  /** The AST stage (rendered inline via the culture-entry editor). */
  readonly astStage = computed(() => this.c()?.stages?.find(s => s.key === 'ast') ?? null);
  /** True when every stage is done — enables the case-level sign-out. */
  readonly allDone = computed(() => {
    const st = this.c()?.stages ?? [];
    return st.length > 0 && st.every(s => s.state === 'done');
  });
  astSummary(): string {
    const m = this.astValue();
    if (m.noGrowth) return 'No growth';
    if (m.organisms?.length) return m.organisms.map(o => o.name).filter(Boolean).join(', ');
    return '';
  }

  back() { this.router.navigate(['/lab/my-work']); }

  // ── Draft autosave (per stage, in localStorage) ─────────────────────────
  private draftKey(key: string) { return `pf.cw.draft.${this.id}.${key}`; }
  onDraft(key: string, val: string) {
    this.drafts.update(d => ({ ...d, [key]: val }));
    try { localStorage.setItem(this.draftKey(key), val); } catch { /* ignore */ }
  }
  private loadDrafts(stages: CultureStageView[]) {
    const d: Record<string, string> = {};
    for (const s of stages) {
      try { const v = localStorage.getItem(this.draftKey(s.key)); if (v) d[s.key] = v; } catch { /* ignore */ }
    }
    this.drafts.set(d);
  }
  private clearDraft(key: string) {
    try { localStorage.removeItem(this.draftKey(key)); } catch { /* ignore */ }
    this.drafts.update(d => { const n = { ...d }; delete n[key]; return n; });
  }

  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('orderTestId') ?? '';
    this.focusStage.set(this.route.snapshot.queryParamMap.get('stage'));
    this.load();
    this.api.get<{ name: string }[]>('/api/microbiology/organisms').subscribe({
      next: rows => this.organismNames.set((rows ?? []).map(o => o.name).filter(Boolean)),
      error: () => { /* falls back to the built-in common isolates */ },
    });
    this.timer = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  private load() {
    this.loading.set(true);
    this.api.get<CultureCaseView>(`/api/microbiology/culture/${this.id}`).subscribe({
      next: c => {
        this.c.set(c ?? null);
        this.loadDrafts(c?.stages ?? []);
        // Rehydrate the AST editor from a saved/in-progress result.
        const ast = c?.stages?.find(s => s.key === 'ast');
        if (ast?.valuesJson) { try { this.astValue.set(JSON.parse(ast.valuesJson) as CultureResult); } catch { /* keep empty */ } }
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); },
    });
  }

  /** Live "held" duration for a picked stage (recomputes as `now` ticks). */
  elapsed(s: CultureStageView): string | null {
    if (s.state !== 'picked' || !s.pickedAt) return null;
    const ms = this.now() - new Date(s.pickedAt).getTime();
    if (Number.isNaN(ms) || ms < 0) return null;
    const m = Math.floor(ms / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  isMine(s: CultureStageView): boolean {
    return !!s.holderUserId && s.holderUserId === this.auth.user()?.id;
  }
  lockedByOther(s: CultureStageView): boolean {
    return s.state === 'picked' && !this.isMine(s);
  }

  // ── Incubation ──────────────────────────────────────────────────────────
  private readonly incubationStages = new Set(['growth', 'identification', 'ast']);
  requiresIncubation(key: string): boolean { return this.incubationStages.has(key); }
  /** True while a stage's incubation clock is still running. */
  incubating(s: CultureStageView): boolean {
    if (!s.incubateUntil) return false;
    const t = new Date(s.incubateUntil).getTime();
    return !Number.isNaN(t) && t > this.now();
  }
  /** Live "ready in …" countdown (recomputes as `now` ticks). */
  incubateReadyIn(s: CultureStageView): string {
    if (!s.incubateUntil) return '';
    const ms = new Date(s.incubateUntil).getTime() - this.now();
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  incubate(s: CultureStageView) {
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/incubate`, {}));
  }

  private run(obs: Observable<CultureCaseView>, ok?: string) {
    this.busy.set(true);
    obs.subscribe({
      next: c => {
        if (c) this.c.set(c);
        if (ok) this.toasts.success(ok);
        this.busy.set(false);
      },
      error: (e: { error?: { message?: string } }) => {
        this.toasts.error(e?.error?.message || 'Could not update the stage');
        this.busy.set(false);
        this.load(); // re-sync in case another tech changed it
      },
    });
  }

  pick(s: CultureStageView) {
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/pick`, {}));
  }
  drop(s: CultureStageView) {
    this.run(this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/drop`, {}));
  }

  /** Hand this stage to another tech (reuses the shared delegate picker). */
  readonly delegating = signal<CultureStageView | null>(null);
  startDelegate(s: CultureStageView) { this.delegating.set(s); }
  doDelegate(s: CultureStageView, toUserId: string) {
    this.delegating.set(null);
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/delegate`, { toUserId }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.success(`${s.label} delegated`);
        // Stay on the case — the row flips to that tech (grayed out).
        this.load();
      },
      error: (e: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.toasts.error(e?.error?.message || 'Could not delegate the stage');
        this.load();
      },
    });
  }
  submit(s: CultureStageView) {
    let valuesJson: string | null;
    if (s.key === 'ast') {
      valuesJson = JSON.stringify(this.astValue());
    } else {
      const notes = (this.drafts()[s.key] ?? '').trim();
      valuesJson = notes ? JSON.stringify({ notes }) : null;
    }
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/submit`, { valuesJson }).subscribe({
      next: c => {
        this.busy.set(false);
        this.toasts.success(`${s.label} submitted`);
        this.clearDraft(s.key);
        if (s.key === 'ast') this.astOpen.set(false);
        if (c) this.c.set(c); // stay on the case — the row flips to done
      },
      error: (e: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.toasts.error(e?.error?.message || 'Could not submit the stage');
        this.load();
      },
    });
  }

  submitForSignout() {
    this.busy.set(true);
    this.api.post(`/api/microbiology/culture/${this.id}/submit-for-signout`, {}).subscribe({
      next: () => { this.busy.set(false); this.toasts.success('Sent for pathologist sign-out'); this.router.navigate(['/lab/my-work']); },
      error: () => { this.busy.set(false); this.toasts.error('Could not submit for sign-out'); },
    });
  }

  readable(valuesJson: string): string {
    try {
      const o = JSON.parse(valuesJson);
      if (o?.notes) return o.notes;
      if (o?.noGrowth) return 'No growth';
      if (Array.isArray(o?.organisms) && o.organisms.length) {
        return o.organisms.map((g: { name?: string; antibiotics?: unknown[] }) =>
          (g?.name || 'Organism') + (g?.antibiotics?.length ? ` (${g.antibiotics.length} abx)` : '')).join('; ');
      }
      return valuesJson;
    } catch { return valuesJson; }
  }
}
