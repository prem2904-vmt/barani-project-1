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
  imports: [FormsModule, ScreenHeaderComponent, TileComponent, CultureEntryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10 max-w-3xl mx-auto w-full">
      <pf-screen-header
        [eyebrow]="eyebrow()"
        [title]="c()?.barcode || c()?.sampleId || 'Culture case'"
        [subtitle]="subtitle()"
        parentRoute="/lab/my-work">
        <div actions>
          @if (c()?.caseState === 'awaiting_signout') {
            <span class="pf-cw__await">Awaiting pathologist sign-out</span>
          } @else if (!focusStage()) {
            <button type="button" class="pf-cw__signout press" [disabled]="busy()" (click)="submitForSignout()">
              Submit for sign-out
            </button>
          }
        </div>
      </pf-screen-header>

      @if (loading()) {
        <pf-tile tone="default" padding="xl"><p class="text-center text-sm" style="color: var(--text-tertiary);">Loading…</p></pf-tile>
      } @else if (!c()) {
        <pf-tile tone="default" padding="xl"><p class="text-center text-sm" style="color: var(--text-tertiary);">Case not found.</p></pf-tile>
      } @else {
        @for (s of visibleStages(); track s.key) {
          <pf-tile tone="default" padding="lg" class="block mb-4">
            <div class="pf-cw__head">
              <div class="min-w-0">
                <h3 class="pf-cw__title">{{ s.label }}</h3>
                <p class="pf-cw__state">
                  @switch (s.state) {
                    @case ('done') { <span class="c-done">✓ Done{{ s.doneByName ? ' · ' + s.doneByName : '' }}</span> }
                    @case ('picked') {
                      @if (isMine(s)) { <span class="c-mine">In progress · you</span> }
                      @else { <span class="c-held">In progress · {{ s.holderName || 'another tech' }}</span> }
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
                  <button type="button" class="pf-cw__btn press" [disabled]="busy()" (click)="drop(s)">Drop</button>
                  <button type="button" class="pf-cw__btn pf-cw__btn--primary press" [disabled]="busy()" (click)="submit(s)">Submit</button>
                }
              </div>
            </div>

            @if (s.state === 'picked' && isMine(s)) {
              @if (s.key === 'ast') {
                <!-- AST stage: the full organism + antibiotic-sensitivity editor
                     (S/I/R, zones, CLSI auto-interpretation), organism list
                     driven by the microbiology master. -->
                <pf-culture-entry [value]="astValue()" [organismNames]="organismNames()"
                                  (valueChange)="astValue.set($event)"></pf-culture-entry>
              } @else {
                <textarea class="pf-cw__notes" rows="3" [(ngModel)]="drafts[s.key]"
                          placeholder="Findings for this stage…"></textarea>
              }
            } @else if (s.state === 'done' && s.valuesJson) {
              <pre class="pf-cw__val">{{ readable(s.valuesJson) }}</pre>
            }
          </pf-tile>
        }
      }
    </section>
  `,
  styles: [`
    .pf-cw__signout { padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 700; color: #fff;
      background: var(--gradient-primary, var(--brand, #a855f7)); border: 1px solid transparent; cursor: pointer; }
    .pf-cw__signout:disabled { opacity: .5; cursor: default; }
    .pf-cw__await { font-size: 12.5px; font-weight: 600; color: #b45309; }
    .pf-cw__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .pf-cw__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-cw__state { margin: 4px 0 0; font-size: 12.5px; }
    .c-done { color: #15803d; font-weight: 600; }
    .c-mine { color: #7c3aed; font-weight: 600; }
    .c-held { color: #b45309; font-weight: 600; }
    .c-open { color: var(--text-tertiary); }
    .pf-cw__timer { color: var(--text-tertiary); font-weight: 500; }
    .pf-cw__actions { display: flex; gap: 8px; flex-shrink: 0; }
    .pf-cw__btn { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-cw__btn--primary { color: #fff; background: var(--gradient-primary, var(--brand, #a855f7)); border-color: transparent; }
    .pf-cw__btn:disabled { opacity: .5; cursor: default; }
    .pf-cw__notes { width: 100%; margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 13.5px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; resize: vertical; }
    .pf-cw__val { margin-top: 10px; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; white-space: pre-wrap;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
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
