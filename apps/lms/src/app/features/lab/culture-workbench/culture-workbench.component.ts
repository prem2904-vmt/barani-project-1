import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
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
  imports: [FormsModule, ScreenHeaderComponent, TileComponent, CultureEntryComponent, DelegateModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="pf-cse__note">Loading…</div>
    } @else if (!c()) {
      <div class="pf-cse__note">Case not found.</div>
    } @else if (focusStage() && stage(); as s) {
      <!-- ── Single-stage entry — same shape as the standard result-entry ── -->
      <section class="pf-cse">
        <header class="pf-cse__hdr">
          <button type="button" class="pf-cse__back" (click)="back()" aria-label="Back">‹</button>
          <div class="pf-cse__titles">
            <div class="pf-cse__eyebrow">{{ (c()!.departmentName || 'Microbiology') }} · {{ s.label }}</div>
            <div class="pf-cse__id">{{ c()!.barcode || c()!.sampleId || '—' }}</div>
            <div class="pf-cse__patient">{{ c()!.patientName || '—' }}<span class="pf-cse__mid">·</span>{{ c()!.testName || 'Culture' }}</div>
          </div>
          @if (s.state === 'picked' && s.holderName) {
            <span class="pf-cse__tech"><span class="pf-cse__tech-dot"></span>{{ s.holderName }}
              @if (elapsed(s); as e) { <span class="pf-cse__held">· {{ e }}</span> }</span>
          }
        </header>

        <div class="pf-cse__scroll">
          @if (s.state === 'picked' && isMine(s)) {
            @if (s.key === 'ast') {
              <div class="pf-cse__ast"><pf-culture-entry [value]="astValue()" [organismNames]="organismNames()"
                                                          (valueChange)="astValue.set($event)"></pf-culture-entry></div>
            } @else {
              <div class="pf-cse__grid-wrap">
                <table class="pf-cse__grid">
                  <thead><tr><th class="pf-cse__th pf-cse__th--param">Parameter</th><th class="pf-cse__th">Result</th></tr></thead>
                  <tbody>
                    <tr class="pf-cse__row">
                      <td class="pf-cse__param">{{ s.label }}</td>
                      <td class="pf-cse__cell">
                        <textarea class="pf-cse__input" rows="4" [(ngModel)]="drafts[s.key]" placeholder="Enter findings…"></textarea>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            }
          } @else if (s.state === 'open') {
            <div class="pf-cse__msg">
              <p>This stage isn't picked up yet.</p>
              <button type="button" class="pf-cse__submit" [disabled]="busy()" (click)="pick(s)">Pick up this stage</button>
            </div>
          } @else if (s.state === 'done') {
            <div class="pf-cse__grid-wrap">
              <table class="pf-cse__grid">
                <thead><tr><th class="pf-cse__th pf-cse__th--param">Parameter</th><th class="pf-cse__th">Result</th></tr></thead>
                <tbody><tr class="pf-cse__row"><td class="pf-cse__param">{{ s.label }}</td>
                  <td class="pf-cse__cell pf-cse__cell--done">✓ {{ readable(s.valuesJson || '') }}</td></tr></tbody>
              </table>
            </div>
          } @else {
            <div class="pf-cse__msg"><p>Held by {{ s.holderName || 'another tech' }}.</p></div>
          }
        </div>

        @if (s.state === 'picked' && isMine(s)) {
          <footer class="pf-cse__footer">
            <button type="button" class="pf-cse__ghost" [disabled]="busy()" (click)="drop(s)">Drop</button>
            <button type="button" class="pf-cse__ghost" [disabled]="busy()" (click)="startDelegate(s)">Delegate</button>
            <button type="button" class="pf-cse__submit" [disabled]="busy()" (click)="submit(s)">Submit result</button>
          </footer>
        }
      </section>
    } @else {
      <!-- ── Full case (no stage focused): the staged overview ── -->
      <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-3xl mx-auto w-full">
        <pf-screen-header [eyebrow]="eyebrow()" [title]="c()?.barcode || c()?.sampleId || 'Culture case'"
                          [subtitle]="subtitle()" parentRoute="/lab/my-work">
          <div actions>
            @if (c()?.caseState === 'awaiting_signout') {
              <span class="pf-cw__await">Awaiting pathologist sign-out</span>
            } @else {
              <button type="button" class="pf-cw__signout press" [disabled]="busy()" (click)="submitForSignout()">Submit for sign-out</button>
            }
          </div>
        </pf-screen-header>
        @for (s of visibleStages(); track s.key) {
          <pf-tile tone="default" padding="lg" class="block mb-4">
            <div class="pf-cw__head">
              <div class="min-w-0">
                <h3 class="pf-cw__title">{{ s.label }}</h3>
                <p class="pf-cw__state">
                  @switch (s.state) {
                    @case ('done') { <span class="c-done">✓ Done{{ s.doneByName ? ' · ' + s.doneByName : '' }}</span> }
                    @case ('picked') {
                      @if (isMine(s)) { <span class="c-mine">In progress · you</span> } @else { <span class="c-held">In progress · {{ s.holderName || 'another tech' }}</span> }
                      @if (elapsed(s); as e) { <span class="pf-cw__timer">· held {{ e }}</span> }
                    }
                    @default { <span class="c-open">Open</span> }
                  }
                </p>
              </div>
              <div class="pf-cw__actions">
                @if (s.state === 'open') {
                  <button type="button" class="pf-cw__btn pf-cw__btn--primary press" [disabled]="busy()" (click)="pick(s)">Pick up</button>
                } @else if (s.state === 'picked' && isMine(s)) {
                  <button type="button" class="pf-cw__btn press" [disabled]="busy()" (click)="submit(s)">Open entry</button>
                }
              </div>
            </div>
          </pf-tile>
        }
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

    .pf-cse__scroll { flex: 1; padding: 22px 24px 96px; }
    .pf-cse__ast { max-width: 820px; }
    .pf-cse__grid-wrap { border: 1px solid var(--glass-border); border-radius: 12px; overflow: hidden; }
    .pf-cse__grid { width: 100%; border-collapse: collapse; }
    .pf-cse__th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-tertiary); padding: 13px 18px; background: rgba(124,58,237,0.09); border-bottom: 1px solid var(--glass-border); }
    .pf-cse__th--param { width: 34%; }
    .pf-cse__row td { border-bottom: 1px solid var(--glass-border); vertical-align: top; }
    .pf-cse__param { padding: 16px 18px; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-cse__cell { padding: 12px 18px; }
    .pf-cse__cell--done { color: #15803d; font-weight: 600; }
    .pf-cse__input { width: 100%; padding: 10px 12px; border-radius: 8px; font-size: 13.5px; color: var(--text-primary);
      background: var(--input-bg); border: 1px solid var(--input-border); outline: none; resize: vertical; box-sizing: border-box; }
    .pf-cse__input:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,.18); }
    .pf-cse__msg { padding: 40px; text-align: center; color: var(--text-tertiary); display: flex; flex-direction: column; gap: 16px; align-items: center; }

    .pf-cse__footer { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px;
      padding: 14px 24px; background: var(--bg-card, #12121a); border-top: 1px solid var(--glass-border); }
    .pf-cse__ghost { padding: 11px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cse__ghost:disabled { opacity: .5; cursor: default; }
    .pf-cse__submit { flex: 1; padding: 12px; border-radius: 12px; font-size: 14px; font-weight: 800; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-cse__submit:disabled { opacity: .55; cursor: default; }

    /* Full-case overview (kept). */
    .pf-cw__signout { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; color: #fff;
      background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-cw__signout:disabled { opacity: .5; cursor: default; }
    .pf-cw__await { font-size: 12.5px; font-weight: 600; color: #b45309; }
    .pf-cw__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .pf-cw__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-cw__state { margin: 4px 0 0; font-size: 12.5px; }
    .c-done { color: #15803d; font-weight: 600; } .c-mine { color: #7c3aed; font-weight: 600; }
    .c-held { color: #b45309; font-weight: 600; } .c-open { color: var(--text-tertiary); }
    .pf-cw__timer { color: var(--text-tertiary); font-weight: 500; }
    .pf-cw__actions { display: flex; gap: 8px; flex-shrink: 0; }
    .pf-cw__btn { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cw__btn--primary { color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border-color: transparent; }
    .pf-cw__btn:disabled { opacity: .5; cursor: default; }
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
  /** Per-stage draft notes, keyed by stage key. */
  drafts: Record<string, string> = {};
  /** The AST stage's structured result (organisms + S/I/R). */
  readonly astValue = signal<CultureResult>({});
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

  /** The single focused stage (when arrived via ?stage=…). */
  readonly stage = computed(() => this.visibleStages()[0] ?? null);

  back() { this.router.navigate(['/lab/my-work']); }

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
        // The stage is no longer mine → back to the bench.
        if (this.focusStage()) this.router.navigate(['/lab/my-work']); else this.load();
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
      const notes = (this.drafts[s.key] ?? '').trim();
      valuesJson = notes ? JSON.stringify({ notes }) : null;
      delete this.drafts[s.key];
    }
    this.busy.set(true);
    this.api.post<CultureCaseView>(`/api/microbiology/culture/${this.id}/stage/${s.key}/submit`, { valuesJson }).subscribe({
      next: c => {
        this.busy.set(false);
        this.toasts.success(`${s.label} submitted`);
        // Focused single-stage entry → back to the bench to pick the next stage
        // (mirrors saving a result and returning to the queue).
        if (this.focusStage()) this.router.navigate(['/lab/my-work']);
        else if (c) this.c.set(c);
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
