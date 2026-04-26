import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { OrderSample, OrderTest } from '../../../shared/models/order.model';
import { TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import { OrderTestComment } from '../../../shared/models/comment.model';
import { CommentThreadComponent } from '../../../shared/components/comment-thread/comment-thread.component';

interface BulkSubmitResponse {
  sample: OrderSample;
  submitted: number;
  results: Array<{
    orderTest: OrderTest;
    flags: { critical: boolean; notifications: string[] };
  }>;
}

/**
 * Sample-level result entry. One barcode scan loads ALL tests on the
 * tube; tech enters every value in one screen and submits once. Backend
 * runs the conditions engine per test and returns combined flags.
 *
 * The unit of work is the tube, not the individual test — see Fix 6 in
 * the brief that introduced this view.
 */
@Component({
  selector: 'pf-sample-result-entry',
  standalone: true,
  imports: [CommonModule, FormsModule, CommentThreadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Full-width container matching FD/collect screens — was centered
         to 880px which left huge empty gutters on lab terminals. -->
    <section class="pf-sre px-4 md:px-8 lg:px-10 pt-6 pb-10">
      <header class="pf-sre__hdr">
        <button type="button" class="pf-sre__back" (click)="back()" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Back
        </button>
        @if (sample(); as s) {
          <div class="pf-sre__hdr-title">
            <p class="pf-sre__eyebrow">{{ s.department?.code ?? 'Tube' }} · {{ s.barcode || '—' }}</p>
            <h1 class="pf-sre__title">{{ s.order?.patient?.displayName ?? 'Patient' }}</h1>
            <p class="pf-sre__sub">{{ s.tests?.length ?? 0 }} test{{ (s.tests?.length ?? 0) === 1 ? '' : 's' }} on this tube</p>
          </div>
        }
      </header>

      @if (loading()) {
        <p class="pf-sre__msg">Loading sample…</p>
      } @else if (!sample()) {
        <p class="pf-sre__msg pf-sre__msg--err">Sample not found.</p>
      } @else {
        <!-- Top-of-screen banner when one or more tests on this tube
             were sent back. Lists the affected tests + the pathologist's
             reason so the tech sees the why before scrolling into the
             entry sections. -->
        @if (rejectedTests().length > 0) {
          <div class="pf-sre__reject-banner">
            <div class="pf-sre__reject-banner-head">
              <span class="pf-sre__reject-icon" aria-hidden="true">↻</span>
              <span class="pf-sre__reject-title">
                Sent back for re-entry · {{ rejectedTests().length }} test{{ rejectedTests().length === 1 ? '' : 's' }}
              </span>
            </div>
            <ul class="pf-sre__reject-list">
              @for (r of rejectedTests(); track r.id) {
                <li class="pf-sre__reject-item">
                  <span class="pf-sre__reject-test">{{ r.test?.name ?? 'Test' }}</span>
                  <span class="pf-sre__reject-reason">{{ r.rejectionReason || '(no reason given)' }}</span>
                </li>
              }
            </ul>
          </div>
        }

        @for (t of sample()!.tests ?? []; track t.id) {
          <section class="pf-sre__test"
                   [class.pf-sre__test--done]="t.status === 'entered' || t.status === 'validated'"
                   [class.pf-sre__test--rejected]="t.status === 're_entry'">
            <header class="pf-sre__test-hdr">
              <h2 class="pf-sre__test-name">{{ t.test?.name ?? 'Test' }}</h2>
              @if (t.status === 're_entry') {
                <span class="pf-sre__test-pill pf-sre__test-pill--rejected">Re-entry needed</span>
              } @else if (t.status === 'entered' || t.status === 'validated') {
                <span class="pf-sre__test-pill">Entered</span>
              }
            </header>
            <!-- Per-test rejection reason — repeats the banner info but
                 right next to the inputs the tech is about to edit, so
                 they don't have to scroll back up to remember WHY. -->
            @if (t.status === 're_entry' && t.rejectionReason) {
              <p class="pf-sre__test-reject-reason">
                <strong>Pathologist note:</strong> {{ t.rejectionReason }}
              </p>
            }

            <!-- Overall conversation thread for THIS test — comments
                 with parameterName == null. Tech can drop an
                 observation here ("patient was nervous, two attempts")
                 and reply to validator corrections. Auto-resolves
                 after Submit All. -->
            <div class="pf-sre__test-comments">
              <pf-comment-thread
                [comments]="commentsFor(t.id, null)"
                currentRole="tech"
                (add)="addOverallComment(t.id, $event.body, $event.type)"
                (reply)="replyToOverall(t.id, $event.parentId, $event.body)">
              </pf-comment-thread>
            </div>

            @if (parametersFor(t).length === 0) {
              <p class="pf-sre__test-empty">No parameter schema — this test has no inputs.</p>
            } @else {
              <div class="pf-sre__params">
                @for (p of parametersFor(t); track p.name) {
                  <!-- Two siblings inside a wrapper <div>: the <label>
                       (input + label + hint) and the comment-thread.
                       Previously the thread sat INSIDE the <label>,
                       and clicks on Reply / Send / Add got stolen by
                       the label's "focus the input" behavior — buttons
                       worked on validator side (in <div>) but not here. -->
                  <div class="pf-sre__param-wrap"
                       [class.pf-sre__param-wrap--flagged]="hasOpenComment(t.id, p.name)">
                    <label class="pf-sre__param">
                      <span class="pf-sre__param-label">
                        {{ p.title || p.name }}
                        @if (p.unit) { <span class="pf-sre__unit">({{ p.unit }})</span> }
                        @if (hasOpenComment(t.id, p.name)) {
                          <span class="pf-sre__param-flag" title="Pathologist commented on this parameter">↻</span>
                        }
                      </span>
                      @switch (inputKindFor(p)) {
                        @case ('number') {
                          <input type="number" class="pf-sre__input"
                                 [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                 [ngModel]="getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                        @case ('textarea') {
                          <textarea class="pf-sre__input pf-sre__input--ta" rows="2"
                                    [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                    [ngModel]="getValue(t.id, p.name)"
                                    (ngModelChange)="setValue(t.id, p.name, $event)"></textarea>
                        }
                        @case ('select') {
                          <select class="pf-sre__input"
                                  [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                  [ngModel]="getValue(t.id, p.name)"
                                  (ngModelChange)="setValue(t.id, p.name, $event)">
                            <option value="">—</option>
                            @for (o of (p.options ?? []); track o) {
                              <option [value]="o">{{ o }}</option>
                            }
                          </select>
                        }
                        @case ('checkbox') {
                          <input type="checkbox" class="pf-sre__cb"
                                 [ngModel]="!!getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                        @case ('date') {
                          <input type="date" class="pf-sre__input"
                                 [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                 [ngModel]="getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                        @default {
                          <input type="text" class="pf-sre__input"
                                 [class.pf-sre__input--flagged]="hasOpenComment(t.id, p.name)"
                                 [ngModel]="getValue(t.id, p.name)"
                                 (ngModelChange)="setValue(t.id, p.name, $event)" />
                        }
                      }
                      @if (p.normalValue || p.criticalLow != null || p.criticalHigh != null) {
                        <span class="pf-sre__hint">
                          @if (p.normalValue) { Normal: {{ p.normalValue }} }
                          @if (p.criticalLow != null) { · Crit&lt; {{ p.criticalLow }} }
                          @if (p.criticalHigh != null) { · Crit&gt; {{ p.criticalHigh }} }
                        </span>
                      }
                    </label>

                    <!-- Per-parameter conversation thread, OUTSIDE the
                         label so its Reply / Send / Add buttons work. -->
                    @if (commentsFor(t.id, p.name).length > 0 || hasOpenComment(t.id, p.name)) {
                      <div class="pf-sre__param-comments">
                        <pf-comment-thread
                          [comments]="commentsFor(t.id, p.name)"
                          currentRole="tech"
                          [composeLabel]="'Add note on this parameter'"
                          (add)="addParameterComment(t.id, p.name, $event.body, $event.type)"
                          (reply)="replyToParameter(t.id, p.name, $event.parentId, $event.body)">
                        </pf-comment-thread>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </section>
        }

        <footer class="pf-sre__footer">
          <button type="button" class="pf-sre__submit"
                  [disabled]="submitting()"
                  (click)="submitAll()">
            {{ submitting() ? 'Submitting…' : 'Submit All Results' }}
          </button>
        </footer>

        @if (lastFlags().length > 0) {
          <ul class="pf-sre__flags">
            @for (f of lastFlags(); track f.label) {
              <li class="pf-sre__flag" [class.pf-sre__flag--crit]="f.critical">
                <strong>{{ f.label }}</strong>{{ f.note ? ' · ' + f.note : '' }}
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; overflow-y: auto; overflow-x: hidden; }
    /* Full-width like FD/collect — Tailwind utility classes on the
       outer section provide the responsive padding; no max-width or
       margin auto here so the screen actually fills the lab terminal. */
    .pf-sre { width: 100%; }

    /* Mobile breakpoint — phones (<640px). Tighter every-thing so
       the form fits a 5" screen without horizontal scroll, and the
       submit button stays on screen so the tech doesn't lose it
       below the fold. */
    @media (max-width: 639px) {
      .pf-sre__hdr {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding-bottom: 12px;
        margin-bottom: 12px;
      }
      .pf-sre__title { font-size: 18px; }
      .pf-sre__sub { font-size: 11.5px; }
      .pf-sre__test {
        padding: 12px 14px;
        margin-bottom: 10px;
      }
      .pf-sre__test-name { font-size: 14px; }
    }
    .pf-sre__hdr {
      display: flex; align-items: flex-start; gap: 14px;
      padding-bottom: 18px; margin-bottom: 18px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-sre__back {
      display: inline-flex; align-items: center; gap: 4px;
      height: 36px; padding: 0 12px;
      border-radius: 8px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      font-size: 13px; font-weight: 500;
      cursor: pointer;
    }
    .pf-sre__back:hover { color: var(--text-primary); }
    .pf-sre__hdr-title { flex: 1; min-width: 0; }
    .pf-sre__eyebrow {
      margin: 0; font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--text-tertiary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-sre__title { margin: 4px 0 2px; font-size: 22px; font-weight: 700; color: var(--text-primary); }
    .pf-sre__sub { margin: 0; font-size: 12.5px; color: var(--text-secondary); }

    .pf-sre__msg { color: var(--text-secondary); font-size: 13px; padding: 24px 0; text-align: center; }
    .pf-sre__msg--err { color: #fca5a5; }

    .pf-sre__test {
      padding: 16px 18px;
      margin-bottom: 14px;
      border-radius: 14px;
      background: var(--bg-card-solid, rgba(20, 22, 30, 0.6));
      border: 1px solid var(--glass-border);
    }
    .pf-sre__test--done {
      border-color: rgba(16, 185, 129, 0.4);
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.06), transparent 60%);
    }
    .pf-sre__test--rejected {
      border-color: rgba(239, 68, 68, 0.34);
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), transparent 60%);
    }
    .pf-sre__test-pill--rejected {
      background: rgba(239, 68, 68, 0.18);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.34);
    }
    .pf-sre__test-reject-reason {
      margin: -4px 0 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.10);
      border-left: 3px solid #ef4444;
      font-size: 12.5px;
      color: var(--text-secondary);
    }
    .pf-sre__test-reject-reason strong {
      color: #fca5a5;
      margin-right: 4px;
    }

    /* Top-of-screen banner — appears once per re-entered sample. */
    .pf-sre__reject-banner {
      padding: 14px 16px;
      margin-bottom: 18px;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.14), rgba(239, 68, 68, 0.04));
      border: 1px solid rgba(239, 68, 68, 0.34);
    }
    .pf-sre__reject-banner-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 8px;
    }
    .pf-sre__reject-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22);
      color: #fca5a5;
      font-size: 13px; font-weight: 700;
      flex-shrink: 0;
    }
    .pf-sre__reject-title {
      font-size: 12px; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
      color: #fca5a5;
    }
    .pf-sre__reject-list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 4px;
    }
    .pf-sre__reject-item {
      display: flex; gap: 10px; align-items: baseline;
      font-size: 13px; line-height: 1.4;
    }
    .pf-sre__reject-test {
      font-weight: 600; color: var(--text-primary); flex-shrink: 0;
    }
    .pf-sre__reject-test::after { content: ':'; }
    .pf-sre__reject-reason {
      color: var(--text-secondary); flex: 1; min-width: 0;
    }
    .pf-sre__test-hdr {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 12px;
    }
    .pf-sre__test-name { margin: 0; flex: 1; font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .pf-sre__test-pill {
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      padding: 3px 10px; border-radius: 9999px;
      background: rgba(16, 185, 129, 0.18); color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .pf-sre__test-empty { font-size: 13px; color: var(--text-tertiary); margin: 0; }

    .pf-sre__params {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @media (min-width: 720px) {
      .pf-sre__params { grid-template-columns: 1fr 1fr; }
    }
    .pf-sre__param { display: flex; flex-direction: column; gap: 4px; }
    .pf-sre__param-label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
    .pf-sre__unit { color: var(--text-tertiary); font-weight: 400; }
    .pf-sre__input {
      width: 100%; min-height: 38px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13.5px;
      font-family: inherit;
    }
    .pf-sre__input:focus { outline: none; border-color: #a855f7; box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.18); }
    .pf-sre__input--ta { resize: vertical; min-height: 56px; font-family: inherit; }
    .pf-sre__cb { width: 18px; height: 18px; }
    .pf-sre__hint { font-size: 10.5px; color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; }

    /* New wrapper around the per-parameter <label> + comment thread.
       Wrapper is the grid cell; label is one block, thread is the
       sibling block — that's how the thread's buttons stay clickable
       (a label was eating their clicks). */
    .pf-sre__param-wrap {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    /* Soft red wash on the whole wrapper when a thread is open here. */
    .pf-sre__param-wrap--flagged {
      padding: 4px;
      margin: -4px;
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.04);
    }

    /* Per-parameter conversation: small bump of breathing room from
       the input so the thread doesn't collide visually with the field. */
    .pf-sre__param-comments {
      margin-top: 8px;
    }
    /* Parameter has an open thread → flag the input visually so the
       tech focuses there before submitting. */
    .pf-sre__input--flagged {
      border-color: rgba(239, 68, 68, 0.6) !important;
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.10);
    }
    .pf-sre__param-flag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px; height: 16px;
      border-radius: 9999px;
      background: rgba(239, 68, 68, 0.22);
      color: #fca5a5;
      font-size: 10px; font-weight: 700;
      margin-left: 6px;
    }

    /* Overall thread block for a test — separates conversation from
       the parameter inputs below it. */
    .pf-sre__test-comments {
      margin-bottom: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--glass-border);
    }

    .pf-sre__footer { position: sticky; bottom: 0; padding: 16px 0 0; background: linear-gradient(to top, var(--bg-page, #04061a) 60%, transparent); }
    .pf-sre__submit {
      width: 100%;
      min-height: 48px;
      border-radius: 12px;
      background: var(--gradient-primary, linear-gradient(135deg, #a855f7, #d946ef));
      color: #fff;
      font-size: 15px; font-weight: 700;
      border: none;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(168, 85, 247, 0.35);
      transition: transform 0.1s, box-shadow 0.2s;
    }
    .pf-sre__submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(168, 85, 247, 0.45); }
    .pf-sre__submit:active { transform: scale(0.98); }
    .pf-sre__submit:disabled { opacity: 0.55; cursor: not-allowed; }

    .pf-sre__flags { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-sre__flag {
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--glass-bg);
      border-left: 3px solid var(--text-secondary);
      font-size: 12.5px;
    }
    .pf-sre__flag--crit { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.08); }
  `]
})
export class SampleResultEntryComponent {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _sample = signal<OrderSample | null>(null);
  private readonly _loading = signal<boolean>(true);
  private readonly _submitting = signal<boolean>(false);
  // values per OrderTestId → param.name → value
  private readonly _values = signal<Record<string, Record<string, unknown>>>({});
  private readonly _flags = signal<Array<{ label: string; note?: string; critical: boolean }>>([]);

  readonly sample = this._sample.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly submitting = this._submitting.asReadonly();
  readonly lastFlags = this._flags.asReadonly();

  /** Tests on this sample that the pathologist sent back for re-entry. */
  readonly rejectedTests = computed<OrderTest[]>(() =>
    (this._sample()?.tests ?? []).filter(t => t.status === 're_entry')
  );

  // ── Validator ↔ tech conversation ─────────────────────────────────
  // Loaded from /api/samples/:id/comments — flat list across every
  // test in the sample. The view splits it: overall (parameterName ===
  // null) under the test header, per-parameter inline under each
  // input field. See comment.model.ts for the threading shape.
  private readonly _comments = signal<OrderTestComment[]>([]);
  readonly comments = this._comments.asReadonly();

  /** Comments for a single test, optionally filtered to one parameter. */
  commentsFor(testId: string, parameterName: string | null = null): OrderTestComment[] {
    return this._comments().filter(c =>
      c.orderTestId === testId &&
      ((parameterName === null && !c.parameterName) || c.parameterName === parameterName)
    );
  }

  /** True if this parameter has at least one open thread — used to
      red-border the input so the tech focuses there. */
  hasOpenComment(testId: string, parameterName: string): boolean {
    return this._comments().some(c =>
      c.orderTestId === testId &&
      c.parameterName === parameterName &&
      !c.isResolved
    );
  }

  // Cached parsed parameters per test so JSON.parse runs once per render.
  private readonly _paramsByTest = computed<Map<string, TestParameter[]>>(() => {
    const out = new Map<string, TestParameter[]>();
    const s = this._sample();
    if (!s) return out;
    for (const t of s.tests ?? []) {
      const raw = t.test?.parameters;
      if (!raw) { out.set(t.id, []); continue; }
      try {
        const blob = JSON.parse(raw) as TestParametersBlob;
        out.set(t.id, blob.parameters ?? []);
      } catch {
        out.set(t.id, []);
      }
    }
    return out;
  });

  parametersFor(t: OrderTest): TestParameter[] {
    return this._paramsByTest().get(t.id) ?? [];
  }

  inputKindFor(p: TestParameter): 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'text' {
    switch (p.type) {
      case 'numeric':
      case 'numeric_with_range': return 'number';
      case 'textarea':           return 'textarea';
      case 'select':
      case 'radio':
      case 'button_select':      return 'select';
      case 'yesno':
      case 'toggle':             return 'checkbox';
      case 'date':               return 'date';
      default:                   return 'text';
    }
  }

  getValue(testId: string, paramName: string): unknown {
    return this._values()[testId]?.[paramName] ?? '';
  }

  setValue(testId: string, paramName: string, v: unknown) {
    this._values.update(all => ({
      ...all,
      [testId]: { ...(all[testId] ?? {}), [paramName]: v }
    }));
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('sampleId');
    if (!id) { this._loading.set(false); return; }
    try {
      const sample = await firstValueFrom(this.api.get<OrderSample>(`/api/samples/${id}/tests`));
      this._sample.set(sample ?? null);
      // Pre-fill from any existing currentResult JSON so the tech can edit
      // a previously-entered value rather than starting from blank.
      if (sample?.tests) {
        const init: Record<string, Record<string, unknown>> = {};
        for (const t of sample.tests) {
          if (!t.currentResult) continue;
          try {
            const parsed = JSON.parse(t.currentResult);
            init[t.id] = parsed?.values ?? {};
          } catch { /* ignore malformed */ }
        }
        this._values.set(init);
      }
      await this.loadComments();
    } catch (e) {
      this.toasts.error('Could not load sample');
    } finally {
      this._loading.set(false);
    }
  }

  private async loadComments() {
    const s = this._sample();
    if (!s) return;
    try {
      const list = await firstValueFrom(this.api.get<OrderTestComment[]>(`/api/samples/${s.id}/comments`));
      this._comments.set(list ?? []);
    } catch { /* non-fatal — entry still works without comments */ }
  }

  async addOverallComment(testId: string, body: string, type: 'observation' | 'correction') {
    await this.postComment(testId, null, null, body, type);
  }
  async replyToOverall(testId: string, parentId: string, body: string) {
    await this.postComment(testId, null, parentId, body, 'observation');
  }
  async addParameterComment(testId: string, paramName: string, body: string, type: 'observation' | 'correction') {
    await this.postComment(testId, paramName, null, body, type);
  }
  async replyToParameter(testId: string, paramName: string, parentId: string, body: string) {
    await this.postComment(testId, paramName, parentId, body, 'observation');
  }

  private async postComment(
    testId: string,
    parameterName: string | null,
    parentId: string | null,
    body: string,
    commentType: 'observation' | 'correction'
  ) {
    try {
      await firstValueFrom(this.api.post<OrderTestComment>(
        `/api/results/${testId}/comments`,
        { parameterName, parentId, commentType, body }
      ));
      await this.loadComments();
    } catch (e) {
      this.toasts.error('Could not post comment');
    }
  }

  async submitAll() {
    const s = this._sample();
    if (!s || this._submitting()) return;
    this._submitting.set(true);
    const all = this._values();
    // Skip tests that the backend will refuse:
    //   - 'validated' is signed off (must be rejected before re-entry)
    //   - 'entered' is awaiting validation (re-saving overwrites the
    //     submitted value, which the backend blocks too)
    // The form pre-fills values for these from currentResult so they
    // can be SEEN, but submitting them would 409 the whole batch.
    const writable = (s.tests ?? []).filter(t =>
      t.status !== 'validated' && t.status !== 'entered'
    );
    const payload = {
      results: writable
        .filter(t => all[t.id] && Object.keys(all[t.id]).length > 0)
        .map(t => ({
          orderTestId: t.id,
          values: all[t.id],
          note: undefined
        }))
    };
    if (payload.results.length === 0) {
      const allDone = (s.tests ?? []).length > 0 && writable.length === 0;
      this.toasts.warning(allDone
        ? 'Every test on this tube is already submitted or validated.'
        : 'Enter at least one value before submitting');
      this._submitting.set(false);
      return;
    }
    try {
      const resp = await firstValueFrom(
        this.api.post<BulkSubmitResponse>(`/api/samples/${s.id}/results`, payload)
      );
      const flags: Array<{ label: string; note?: string; critical: boolean }> = [];
      for (const r of resp?.results ?? []) {
        const name = r.orderTest?.test?.name ?? 'Test';
        if (r.flags?.critical) {
          flags.push({ label: `${name}: critical`, critical: true });
        }
        for (const n of r.flags?.notifications ?? []) {
          flags.push({ label: name, note: n, critical: false });
        }
      }
      this._flags.set(flags);
      this._sample.set(resp?.sample ?? s);
      // Backend auto-resolves correction threads on submit (see
      // ResultService.EnterAsync). Reload to reflect the new
      // resolution state in the UI.
      await this.loadComments();
      this.toasts.success(`Submitted ${resp?.submitted ?? 0} test${(resp?.submitted ?? 0) === 1 ? '' : 's'}`);
    } catch (e) {
      this.toasts.error('Could not submit — try again');
    } finally {
      this._submitting.set(false);
    }
  }

  back() { this.router.navigate(['/lab']); }
}
