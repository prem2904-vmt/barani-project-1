import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderTest } from '../../../shared/models/order.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface ResultSnapshot {
  values?: Record<string, unknown>;
  note?: string;
  flags?: { critical: boolean; notifications: string[] };
}

type Flag = 'normal' | 'abnormal' | 'critical';

interface ValueRow {
  name: string;
  title: string;
  value: unknown;
  unit?: string;
  range?: string;
  flag: Flag;
}

@Component({
  selector: 'pf-validate-result',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-5xl mx-auto">
      <pf-screen-header
        eyebrow="Validation"
        title="Validate result"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
        @if (selected() && !editing()) {
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="startEdit()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </span>
            Edit values
          </pf-touch-btn>
        }
        @if (selected() && editing()) {
          <pf-touch-btn actions size="sm" variant="ghost" (pressed)="cancelEdit()">Cancel</pf-touch-btn>
        }
        @if (selected() && editing()) {
          <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" (pressed)="saveEdits()">
            {{ saving() ? 'Saving…' : 'Save changes' }}
          </pf-touch-btn>
        }
        @if (selected() && !editing()) {
          <pf-touch-btn actions size="sm" variant="secondary" (pressed)="reassign()">Reassign</pf-touch-btn>
        }
        @if (selected() && !editing()) {
          <pf-touch-btn actions size="sm" variant="secondary" (pressed)="reject()">Reject</pf-touch-btn>
        }
        @if (selected() && !editing()) {
          <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" (pressed)="validate()">
            {{ saving() ? 'Validating…' : 'Validate' }}
          </pf-touch-btn>
        }
      </pf-screen-header>

      @if (loading() && !selected()) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[13px]" style="color: var(--text-tertiary);">Loading…</p>
          </div>
        </pf-tile>
      }

      @if (!loading() && !selected()) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">
              Order test not found in the validation queue.
            </p>
          </div>
        </pf-tile>
      }

      @if (selected(); as t) {
        <!-- Patient + test header tile -->
        <pf-tile tone="violet" padding="lg" class="block mb-4">
          <div class="flex items-start gap-3 flex-wrap md:flex-nowrap">
            <pf-avatar [name]="t.subOrder?.order?.patient?.name ?? '—'" [size]="52"></pf-avatar>
            <div class="flex-1 min-w-0">
              <p class="pf-vr-eyebrow">Test</p>
              <p class="font-semibold text-[18px]" style="color: var(--text-primary);">{{ t.test?.name }}</p>
              <p class="text-[12px] font-mono mt-1" style="color: var(--text-tertiary);">
                {{ t.subOrder?.order?.patient?.name }}
                · {{ t.test?.department?.name }}
                · entered {{ t.resultedAt ? (t.resultedAt | date:'MMM d, h:mm a') : '—' }}
              </p>
            </div>
            @if (snapshot()?.flags?.critical) {
              <pf-chip tone="rose" size="sm">CRITICAL</pf-chip>
            }
          </div>
        </pf-tile>

        <!-- Summary strip -->
        @if (valueRows().length > 0) {
          <div class="pf-vr-summary">
            <div class="pf-vr-summary__cell">
              <span class="pf-vr-summary__num">{{ counts().total }}</span>
              <span class="pf-vr-summary__lbl">Parameters</span>
            </div>
            <div class="pf-vr-summary__cell">
              <span class="pf-vr-summary__num" style="color: #10b981;">{{ counts().normal }}</span>
              <span class="pf-vr-summary__lbl">Normal</span>
            </div>
            <div class="pf-vr-summary__cell">
              <span class="pf-vr-summary__num" style="color: #f59e0b;">{{ counts().abnormal }}</span>
              <span class="pf-vr-summary__lbl">Abnormal</span>
            </div>
            <div class="pf-vr-summary__cell">
              <span class="pf-vr-summary__num" style="color: #ef4444;">{{ counts().critical }}</span>
              <span class="pf-vr-summary__lbl">Critical</span>
            </div>
          </div>
        }

        @if (snapshot()?.flags?.critical) {
          <div class="pf-vr-crit-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <path d="M12 9v4"/>
              <path d="M12 17h.01"/>
            </svg>
            <span>Flagged critical — validation notifies the referring doctor.</span>
          </div>
        }

        <!-- Values grid -->
        <section class="mb-4">
          <div class="flex items-center justify-between gap-3 mb-3 px-1">
            <p class="pf-vr-eyebrow m-0">Parameters</p>
            <div class="pf-view-toggle" role="group" aria-label="View density">
              <button type="button"
                      class="pf-view-toggle__btn"
                      [class.pf-view-toggle__btn--on]="view() === 'cards'"
                      (click)="setView('cards')"
                      aria-label="Card grid">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                Cards
              </button>
              <button type="button"
                      class="pf-view-toggle__btn"
                      [class.pf-view-toggle__btn--on]="view() === 'table'"
                      (click)="setView('table')"
                      aria-label="Compact table">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
                Table
              </button>
            </div>
          </div>

          @if (valueRows().length === 0) {
            <pf-tile tone="default" padding="lg">
              <p class="text-[13px]" style="color: var(--text-tertiary);">No values recorded.</p>
            </pf-tile>
          } @else if (view() === 'cards') {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              @for (r of valueRows(); track r.name) {
                <pf-tile [tone]="toneFor(r.flag)" padding="md"
                         [clickable]="!editing()"
                         (tapped)="startEdit(r.name)">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <p class="pf-vr-row__title">{{ r.title }}</p>
                      @if (editing()) {
                        <div class="flex items-baseline gap-2 mt-1">
                          <input type="text"
                                 class="pf-vr-row__input"
                                 [attr.data-param]="r.name"
                                 [value]="editValue(r.name)"
                                 (input)="onEditInput(r.name, $event)"
                                 (click)="$event.stopPropagation()" />
                          @if (r.unit) { <span class="pf-vr-row__unit">{{ r.unit }}</span> }
                        </div>
                      } @else {
                        <p class="pf-vr-row__value">
                          <span>{{ r.value }}</span>
                          @if (r.unit) { <span class="pf-vr-row__unit">{{ r.unit }}</span> }
                        </p>
                      }
                      @if (r.range) {
                        <p class="pf-vr-row__range">Normal · {{ r.range }}</p>
                      }
                    </div>
                    <pf-chip [tone]="chipFor(r.flag)" size="sm">
                      {{ r.flag === 'critical' ? 'Critical' : r.flag === 'abnormal' ? 'Abnormal' : 'Normal' }}
                    </pf-chip>
                  </div>
                </pf-tile>
              }
            </div>
          } @else {
            <pf-tile tone="default" padding="md" class="block">
              <div class="pf-vr-table" role="table">
                <div class="pf-vr-table__head" role="row">
                  <span role="columnheader">Parameter</span>
                  <span role="columnheader">Value</span>
                  <span role="columnheader">Normal</span>
                  <span role="columnheader">Flag</span>
                </div>
                @for (r of valueRows(); track r.name) {
                  <div class="pf-vr-table__row"
                       [attr.data-flag]="r.flag"
                       [class.pf-vr-table__row--clickable]="!editing()"
                       role="row"
                       (click)="!editing() && startEdit(r.name)">
                    <span class="pf-vr-table__name" role="cell">{{ r.title }}</span>
                    <span class="pf-vr-table__value" role="cell">
                      @if (editing()) {
                        <input type="text"
                               class="pf-vr-row__input pf-vr-row__input--sm"
                               [attr.data-param]="r.name"
                               [value]="editValue(r.name)"
                               (input)="onEditInput(r.name, $event)"
                               (click)="$event.stopPropagation()" />
                      } @else {
                        <span>{{ r.value }}</span>
                      }
                      @if (r.unit) { <span class="pf-vr-row__unit">{{ r.unit }}</span> }
                    </span>
                    <span class="pf-vr-table__range" role="cell">{{ r.range ?? '—' }}</span>
                    <span role="cell">
                      <pf-chip [tone]="chipFor(r.flag)" size="sm">
                        {{ r.flag === 'critical' ? 'Critical' : r.flag === 'abnormal' ? 'Abnormal' : 'Normal' }}
                      </pf-chip>
                    </span>
                  </div>
                }
              </div>
            </pf-tile>
          }

          @if (editing()) {
            <p class="pf-vr-edit-hint">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 16v-4"/><path d="M12 8h.01"/><circle cx="12" cy="12" r="10"/>
              </svg>
              Changes apply when you hit Save. Validation flags recompute after save.
            </p>
          }
        </section>

        <!-- Clinical comment -->
        <pf-tile tone="default" padding="lg" class="block">
          <label class="pf-vr-eyebrow block mb-2">Clinical comment <span class="opacity-60 normal-case">(optional)</span></label>
          <textarea class="pf-input min-h-[100px]"
                    [value]="comment()"
                    (input)="onComment($event)"
                    placeholder="Notes for the report or follow-up team…"></textarea>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-vr-eyebrow {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0 0 2px;
    }

    .pf-vr-summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      padding: 14px 16px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      margin-bottom: 14px;
    }
    .pf-vr-summary__cell {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    .pf-vr-summary__num {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .pf-vr-summary__lbl {
      margin-top: 4px;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .pf-vr-crit-banner {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      margin-bottom: 14px;
      font-size: 13px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.28);
      color: #fca5a5;
    }
    .pf-vr-crit-banner svg { flex-shrink: 0; margin-top: 2px; }

    .pf-vr-row__title {
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 0 0 6px;
    }
    .pf-vr-row__value {
      margin: 0;
      font-size: 22px;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .pf-vr-row__unit {
      margin-left: 6px;
      font-size: 12.5px;
      font-weight: 400;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-vr-row__range {
      margin: 6px 0 0;
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-muted);
    }
    .pf-vr-row__input {
      width: 100%;
      max-width: 160px;
      padding: 6px 10px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      color: var(--text-primary);
      font-size: 18px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .pf-vr-row__input:focus {
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
    .pf-vr-edit-hint {
      margin: 10px 0 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: var(--text-tertiary);
    }
    .pf-vr-edit-hint svg { color: var(--text-muted); }

    /* View density toggle */
    .pf-view-toggle {
      display: inline-flex;
      padding: 3px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      gap: 2px;
    }
    .pf-view-toggle__btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      font-size: 11.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      background: transparent;
      border: 0;
      border-radius: 7px;
      cursor: pointer;
      transition: background .12s ease, color .12s ease;
    }
    .pf-view-toggle__btn:hover { color: var(--text-secondary); }
    .pf-view-toggle__btn--on {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.28);
    }
    .pf-view-toggle__btn--on:hover { color: #ffffff; }

    /* Compact table view */
    .pf-vr-table {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) auto;
      row-gap: 0;
      column-gap: 16px;
    }
    .pf-vr-table__head {
      display: contents;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-vr-table__head > span {
      padding: 0 4px 10px;
      border-bottom: 1px solid var(--border-muted);
    }
    .pf-vr-table__row {
      display: contents;
    }
    .pf-vr-table__row > span,
    .pf-vr-table__row > [role='cell'] {
      padding: 12px 4px;
      display: flex;
      align-items: center;
      border-bottom: 1px solid var(--border-muted);
      font-size: 13px;
      color: var(--text-primary);
    }
    .pf-vr-table__row:last-child > span { border-bottom: 0; }
    .pf-vr-table__row--clickable > span { cursor: pointer; }
    .pf-vr-table__row--clickable:hover > span { background: var(--glass-bg); }

    .pf-vr-table__row[data-flag='abnormal'] .pf-vr-table__value span:first-child { color: #fcd34d; font-weight: 600; }
    .pf-vr-table__row[data-flag='critical'] .pf-vr-table__value span:first-child { color: #fca5a5; font-weight: 700; }

    .pf-vr-table__name {
      font-weight: 500;
      color: var(--text-primary);
    }
    .pf-vr-table__value {
      gap: 4px;
      font-variant-numeric: tabular-nums;
    }
    .pf-vr-table__range {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      color: var(--text-tertiary);
    }
    .pf-vr-row__input--sm {
      max-width: 120px;
      padding: 4px 8px;
      font-size: 13.5px;
    }
  `]
})
export class ValidateResultComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _id = signal<string | null>(null);
  private readonly _selected = signal<OrderTest | null>(null);
  private readonly _comment = signal('');
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _editing = signal(false);
  /** Working copy keyed by parameter name. Seeded from the snapshot when editing starts. */
  private readonly _edits = signal<Record<string, unknown>>({});
  private readonly _view = signal<'cards' | 'table'>('cards');
  readonly view = this._view.asReadonly();
  setView(v: 'cards' | 'table') { this._view.set(v); }

  readonly selected = this._selected.asReadonly();
  readonly comment = this._comment.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly editing = this._editing.asReadonly();

  editValue(name: string): string {
    const v = this._edits()[name];
    return v == null ? '' : String(v);
  }
  onEditInput(name: string, ev: Event) {
    const v = (ev.target as HTMLInputElement).value;
    this._edits.update(m => ({ ...m, [name]: v }));
  }

  readonly subtitle = computed(() => {
    if (!this._selected()) return 'Review the entered result.';
    return 'Review values, then edit, validate, reject, reassign, or add a comment.';
  });

  readonly snapshot = computed<ResultSnapshot | null>(() => {
    const raw = this._selected()?.currentResult;
    if (!raw) return null;
    try { return JSON.parse(raw) as ResultSnapshot; } catch { return null; }
  });

  readonly valueRows = computed<ValueRow[]>(() => {
    const t = this._selected();
    const snap = this.snapshot();
    if (!t?.test?.parameters || !snap?.values) return [];

    let params: Array<{
      name: string; title: string; unit?: string;
      criticalLow?: number; criticalHigh?: number;
      referenceRanges?: Array<{ segment: string; min: number; max: number }>;
    }> = [];
    try {
      const blob = JSON.parse(t.test.parameters);
      params = blob.parameters ?? [];
    } catch { return []; }

    return params.map(p => {
      const v = snap.values![p.name];
      const n = Number(v);
      const r = (p.referenceRanges ?? [])[0];
      let flag: Flag = 'normal';
      if (!Number.isNaN(n)) {
        if ((p.criticalLow != null && n <= p.criticalLow) || (p.criticalHigh != null && n >= p.criticalHigh)) flag = 'critical';
        else if (r && (n < r.min || n > r.max)) flag = 'abnormal';
      }
      return {
        name: p.name,
        title: p.title,
        value: v ?? '—',
        unit: p.unit,
        range: r ? `${r.min}–${r.max}${p.unit ? ' ' + p.unit : ''}` : undefined,
        flag
      };
    });
  });

  readonly counts = computed(() => {
    const rows = this.valueRows();
    return {
      total: rows.length,
      normal: rows.filter(r => r.flag === 'normal').length,
      abnormal: rows.filter(r => r.flag === 'abnormal').length,
      critical: rows.filter(r => r.flag === 'critical').length
    };
  });

  toneFor(flag: Flag) {
    return flag === 'critical' ? 'rose' : flag === 'abnormal' ? 'amber' : 'default';
  }
  chipFor(flag: Flag): ChipTone {
    return flag === 'critical' ? 'rose' : flag === 'abnormal' ? 'amber' : 'emerald';
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    this._id.set(id);
    if (!id) return;
    this._loading.set(true);
    this.api.get<OrderTest[]>('/api/validation/queue?mine=false').subscribe({
      next: rows => {
        this._loading.set(false);
        const match = (rows ?? []).find(r => r.id === id) ?? null;
        this._selected.set(match);
      },
      error: () => this._loading.set(false)
    });
  }

  onComment(e: Event) { this._comment.set((e.target as HTMLTextAreaElement).value); }

  back() { this.router.navigateByUrl('/pathologist'); }

  startEdit(focusParam?: string) {
    if (this._editing()) {
      if (focusParam) queueMicrotask(() => this.focusParamInput(focusParam));
      return;
    }
    const snap = this.snapshot();
    const seed: Record<string, unknown> = {};
    for (const r of this.valueRows()) {
      const v = snap?.values?.[r.name];
      seed[r.name] = v == null ? '' : v;
    }
    this._edits.set(seed);
    this._editing.set(true);
    if (focusParam) queueMicrotask(() => this.focusParamInput(focusParam));
  }

  cancelEdit() {
    this._editing.set(false);
    this._edits.set({});
  }

  private focusParamInput(name: string) {
    const el = document.querySelector<HTMLInputElement>(`input[data-param="${CSS.escape(name)}"]`);
    el?.focus();
    el?.select();
  }

  saveEdits() {
    const t = this._selected();
    if (!t || this._saving()) return;

    const edits = this._edits();
    const out: Record<string, unknown> = {};
    for (const r of this.valueRows()) {
      const raw = edits[r.name];
      if (raw === '' || raw == null) { out[r.name] = null; continue; }
      const n = Number(raw);
      out[r.name] = Number.isNaN(n) ? String(raw) : n;
    }

    this._saving.set(true);
    this.api.post<{ orderTest: OrderTest; flags: { critical: boolean } }>(
      `/api/results/${t.id}/enter`,
      { values: out, note: this._comment() || null }
    ).subscribe({
      next: res => {
        this._saving.set(false);
        this._editing.set(false);
        this._edits.set({});
        this._selected.set(res.orderTest);
        if (res.flags.critical) this.toasts.warning('Saved — flagged critical');
        else this.toasts.success('Values updated');
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(e.message ?? 'Save failed');
      }
    });
  }

  validate() {
    const t = this._selected();
    if (!t) return;
    this._saving.set(true);
    this.api.post<OrderTest>(`/api/validation/${t.id}/validate`, { note: this._comment() || null }).subscribe({
      next: () => {
        this._saving.set(false);
        this.toasts.success('Validated');
        this.back();
      },
      error: e => {
        this._saving.set(false);
        this.toasts.error(e.message ?? 'Validation failed');
      }
    });
  }

  async reject() {
    const t = this._selected();
    if (!t) return;
    const reason = await this.dialog.prompt({
      title: 'Reject result?',
      message: `Reject result for ${t.test?.name}. The lab tech will be notified.`,
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject result'
    });
    if (!reason) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reject`, { reason, note: this._comment() || null }).subscribe({
      next: () => {
        this.toasts.success('Rejected — lab tech notified');
        this.back();
      },
      error: e => this.toasts.error(e.message ?? 'Reject failed')
    });
  }

  async reassign() {
    const t = this._selected();
    if (!t) return;
    const id = await this.dialog.prompt({
      title: 'Reassign to pathologist',
      message: `Move "${t.test?.name}" to another pathologist's queue.`,
      placeholder: 'Pathologist user id',
      required: true,
      confirmLabel: 'Reassign'
    });
    if (!id) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reassign`, { assigneeId: id }).subscribe({
      next: () => {
        this.toasts.success('Reassigned');
        this.back();
      },
      error: e => this.toasts.error(e.message ?? 'Reassign failed')
    });
  }
}
