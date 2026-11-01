import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SegmentedComponent, type SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { AssistantApiService } from '../../../shared/assistant/assistant-api.service';
import { assistantError, pickProvider } from '../../../shared/assistant/assistant-logic';
import { PfSenseService } from '../../../core/services/pf-sense.service';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { renderReportPdfBlobUrl, type ReportPdfInput } from '../../../shared/utils/report-pdf';
import { applyChanges, runTidy, toggleChange, type TidyChange, type TidyResult } from '../../../shared/utils/report-tidy';
import { buildTidyRequest, cortexChanges } from '../../../shared/utils/report-tidy-wire';
import { makeTidyProbe } from '../../../shared/utils/report-tidy-probe';

type CortexState = 'idle' | 'loading' | 'done' | 'error' | 'none';

/**
 * Report designer -> "Tidy up with Cortex" review card (report layout plan 6; beta `assistant`, dev only).
 *
 * Step 1 (instant, free): the plain rules (shared/utils/report-tidy.ts) fix overlaps, edges, spacing, text fitting,
 * High / Low in black and white and so on. Each is a NAMED change with its reason.
 * Step 2 (only when something is a judgement call): Cortex gets layout settings and geometry - never a name, a result
 * or any text - and suggests which preset / palette / fix reads best. Its answer is re-validated here.
 *
 * The person ticks what they want and sees Before | After on the sample report (made-up patient data only). "Apply"
 * hands ONE template patch to the editor, which makes it ONE undo step; "Cancel" changes nothing. Nothing is saved until
 * the editor's own Save, and a released report's stored PDF is never touched.
 */
@Component({
  selector: 'pf-report-tidy-card',
  standalone: true,
  imports: [NgTemplateOutlet, SegmentedComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-td-scrim" (click)="close.emit()"></div>
    <section class="pf-td pf-card" role="dialog" aria-modal="true" aria-labelledby="pf-td-title" tabindex="-1" #dlg>
      <header class="pf-td__head">
        <span class="pf-td__spark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3.5 12.9 8.6 18 10.5 12.9 12.4 11 17.5 9.1 12.4 4 10.5 9.1 8.6Z"/><path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7Z"/></svg>
        </span>
        <div class="pf-td__hd">
          <h2 id="pf-td-title" class="pf-td__title">Tidy up with Cortex</h2>
          <p class="pf-td__sub">Review each change, see your report before and after, then apply. Nothing is saved until you press Save.</p>
        </div>
        <span class="pf-td__beta">Beta</span>
      </header>

      @if (phase() === 'checking') {
        <div class="pf-td__state" role="status"><span class="pf-td__dots" aria-hidden="true"></span>Checking your report layout…</div>
      } @else {
        <div class="pf-td__body">
          <div class="pf-td__list">
            @if (all().length === 0) {
              <div class="pf-td__state pf-td__state--clean" role="status">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                <strong>Your report layout is already tidy.</strong>
                <span>No overlaps, edges or spacing to fix.</span>
              </div>
            }

            @if (rules().length) {
              <h3 class="pf-td__h">Fixes <span class="pf-td__n">{{ rules().length }}</span></h3>
              <ul class="pf-td__changes" aria-label="Plain fixes">
                @for (c of rules(); track c.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: c }"></ng-container> }
              </ul>
            }

            @if (cortexState() !== 'none') {
              <h3 class="pf-td__h">Cortex suggests
                @if (cortexState() === 'done') { <span class="pf-td__n">{{ cortexList().length }}</span> }
              </h3>
              @if (cortexState() === 'loading') {
                <div class="pf-td__ask" role="status"><span class="pf-td__dots" aria-hidden="true"></span>Cortex is looking at the judgement calls…</div>
              } @else if (cortexState() === 'error') {
                <div class="pf-td__ask pf-td__ask--err" role="alert">
                  <span>{{ cortexMessage() }}</span>
                  @if (canRetry()) { <button type="button" class="pf-td__link" (click)="askCortex()">Try again</button> }
                </div>
              } @else if (cortexState() === 'done') {
                @if (summary()) { <p class="pf-td__summary">{{ summary() }}</p> }
                @if (cortexList().length) {
                  <ul class="pf-td__changes" aria-label="Cortex suggestions">
                    @for (c of cortexList(); track c.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: c }"></ng-container> }
                  </ul>
                } @else {
                  <p class="pf-td__hint">Cortex had nothing to add.</p>
                }
                @if (droppedNote()) { <p class="pf-td__hint">{{ droppedNote() }}</p> }
              }
            }
          </div>

          <div class="pf-td__prev">
            <div class="pf-td__tabs"><pf-segmented size="sm" [options]="paneOptions" [value]="pane()" (valueChange)="pane.set($event)" ariaLabel="Preview"></pf-segmented></div>
            <div class="pf-td__panes">
              <figure class="pf-td__pane" [class.pf-td__pane--off]="pane() !== 'before'">
                <figcaption>Before</figcaption>
                <iframe #beforeFrame class="pf-td__frame" aria-label="Report before the changes"></iframe>
              </figure>
              <figure class="pf-td__pane" [class.pf-td__pane--off]="pane() !== 'after'">
                <figcaption>After <span class="pf-td__cnt">{{ selectedCount() }} {{ selectedCount() === 1 ? 'change' : 'changes' }}</span></figcaption>
                <iframe #afterFrame class="pf-td__frame" aria-label="Report after the ticked changes"></iframe>
              </figure>
            </div>
            <p class="pf-td__hint">Sample report with made-up patient details. Reports already released keep the PDF they were made with.</p>
          </div>
        </div>

        <footer class="pf-td__foot">
          <pf-touch-btn size="md" variant="ghost" (pressed)="close.emit()">Cancel</pf-touch-btn>
          <pf-touch-btn size="md" variant="primary" [disabled]="selectedCount() === 0" (pressed)="apply()">
            Apply {{ selectedCount() }} {{ selectedCount() === 1 ? 'change' : 'changes' }}
          </pf-touch-btn>
        </footer>
      }
    </section>

    <ng-template #row let-c>
      <li class="pf-td__row">
        <label class="pf-check">
          <input type="checkbox" [checked]="selected().has(c.id)" (change)="tick(c.id, $any($event.target).checked)" [attr.aria-label]="c.title" />
          <span class="pf-check-box" aria-hidden="true">
            @if (selected().has(c.id)) { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg> }
          </span>
        </label>
        <span class="pf-td__txt">
          <span class="pf-td__rt"><span class="pf-td__name">{{ c.title }}</span><span class="pf-td__chip" [class.pf-td__chip--cortex]="c.source === 'cortex'">{{ c.source === 'cortex' ? 'Cortex' : 'Rule' }}</span></span>
          <span class="pf-td__why">{{ c.why }}</span>
        </span>
      </li>
    </ng-template>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 130; display: block; }
    .pf-td-scrim { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.42); backdrop-filter: blur(2px); }
    :host-context(.dark) .pf-td-scrim, :host-context([data-theme='dark']) .pf-td-scrim { background: rgba(0, 0, 0, 0.58); }
    .pf-td {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(1120px, calc(100vw - 32px)); max-height: min(92dvh, 860px);
      display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
      background: var(--pf-card-bg, var(--card-bg)); outline: none;
    }
    .pf-td:hover { transform: translate(-50%, -50%); }
    .pf-td__head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px 12px; border-bottom: 1px solid var(--pf-line); }
    .pf-td__spark { flex: none; width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--pf-sel-bg); color: var(--color-violet-600, #7c3aed); }
    :host-context(.dark) .pf-td__spark, :host-context([data-theme='dark']) .pf-td__spark { color: var(--violet-text, #c4b5fd); }
    .pf-td__hd { flex: 1; min-width: 0; }
    .pf-td__title { margin: 0; font-size: 17px; font-weight: 700; color: var(--text-primary); }
    .pf-td__sub { margin: 2px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--text-muted); }
    .pf-td__beta { flex: none; font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px;
      color: var(--text-tertiary); border: 1px solid var(--pf-line); }
    .pf-td__body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); }
    .pf-td__list { min-height: 0; overflow-y: auto; padding: 8px 16px 16px; border-right: 1px solid var(--pf-line); }
    .pf-td__h { margin: 14px 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-td__n { margin-left: 4px; padding: 0 6px; border-radius: 999px; background: var(--pf-chip-bg); color: var(--text-secondary); font-size: 11px; }
    .pf-td__changes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-td__row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 6px; border-radius: var(--pf-radius-sm, 10px); min-height: 44px; }
    .pf-td__row:hover { background: var(--pf-chip-bg); }
    .pf-check { position: relative; display: inline-flex; cursor: pointer; }
    .pf-td__row .pf-check { flex: none; margin-top: 1px; }
    .pf-check input { position: absolute; inset: -10px; width: calc(100% + 20px); height: calc(100% + 20px); margin: 0; opacity: 0; cursor: pointer; }
    .pf-td__row .pf-check input:focus-visible + .pf-check-box { outline: 2px solid var(--pf-sel-border); outline-offset: 2px; }
    .pf-check-box { width: 20px; height: 20px; border-radius: 6px; background: var(--glass-bg); border: 1px solid var(--glass-border);
      display: inline-flex; align-items: center; justify-content: center; color: transparent; transition: background .15s, border-color .15s, color .15s; }
    .pf-check input:checked + .pf-check-box { background: var(--gradient-primary); border-color: transparent; color: #fff; }
    .pf-td__txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .pf-td__rt { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-td__name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-td__chip { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 1px 7px; border-radius: 999px;
      background: var(--pf-chip-bg); color: var(--text-secondary); }
    .pf-td__chip--cortex { background: var(--pf-sel-bg); color: var(--color-violet-700, #6d28d9); }
    :host-context(.dark) .pf-td__chip--cortex, :host-context([data-theme='dark']) .pf-td__chip--cortex { color: var(--violet-text, #c4b5fd); }
    .pf-td__why { font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
    .pf-td__summary { margin: 0 0 6px; padding: 8px 10px; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); border-radius: var(--pf-radius-sm, 10px); background: var(--pf-chip-bg); }
    .pf-td__hint { margin: 6px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary); }
    .pf-td__ask { display: flex; align-items: center; gap: 10px; padding: 10px; font-size: 12.5px; color: var(--text-secondary); }
    .pf-td__ask--err { color: var(--warning-text, #b45309); }
    .pf-td__link { border: 0; background: none; padding: 4px 6px; font: inherit; font-weight: 600; color: var(--color-violet-600, #7c3aed); cursor: pointer; min-height: 32px; }
    .pf-td__state { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 48px 20px; font-size: 13.5px; color: var(--text-secondary); }
    .pf-td__state--clean { flex-direction: column; text-align: center; gap: 6px; padding: 28px 12px; color: var(--text-secondary); }
    .pf-td__state--clean svg { color: var(--success-text, #15803d); }
    .pf-td__dots { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--pf-line); border-top-color: var(--color-violet-600, #7c3aed); animation: pf-td-spin .8s linear infinite; }
    @keyframes pf-td-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .pf-td__dots { animation: none; } }
    .pf-td__prev { min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 12px; overflow-y: auto; }
    .pf-td__tabs { display: none; }
    .pf-td__panes { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .pf-td__pane { margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-td__pane figcaption { font-size: 12px; font-weight: 700; color: var(--text-secondary); display: flex; gap: 8px; align-items: baseline; }
    .pf-td__cnt { font-weight: 500; color: var(--text-tertiary); }
    .pf-td__frame { width: 100%; flex: 1 1 auto; min-height: 380px; aspect-ratio: 210 / 297; border: 1px solid var(--glass-border, rgba(148,163,184,.25)); border-radius: 10px; background: #525659; }
    .pf-td__foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--pf-line); }
    @media (max-width: 900px) {
      .pf-td { width: calc(100vw - 16px); max-height: 94dvh; }
      .pf-td__body { grid-template-columns: 1fr; overflow-y: auto; }
      .pf-td__list { border-right: 0; border-bottom: 1px solid var(--pf-line); overflow: visible; }
      .pf-td__tabs { display: block; }
      .pf-td__panes { grid-template-columns: 1fr; }
      .pf-td__pane--off { display: none; }
      .pf-td__frame { min-height: 420px; }
    }
  `],
})
export class ReportTidyCardComponent implements OnDestroy {
  private readonly api = inject(AssistantApiService);
  private readonly sense = inject(PfSenseService);

  /** The template as it stands in the editor. */
  readonly tpl = input.required<ReportTemplate>();
  /** The sample report to render (made-up patient data) with its images already loaded. */
  readonly base = input.required<Omit<ReportPdfInput, 'template'>>();
  /** Ask Cortex for the judgement calls (false in specs that only need the rules). */
  readonly withCortex = input(true);

  /** ONE template patch: the editor applies it as a single undo step. */
  readonly applied = output<Partial<ReportTemplate>>();
  readonly close = output<void>();

  readonly dlg = viewChild<ElementRef<HTMLElement>>('dlg');
  readonly beforeFrame = viewChild<ElementRef<HTMLIFrameElement>>('beforeFrame');
  readonly afterFrame = viewChild<ElementRef<HTMLIFrameElement>>('afterFrame');

  readonly phase = signal<'checking' | 'ready'>('checking');
  readonly result = signal<TidyResult | null>(null);
  readonly cortexList = signal<TidyChange[]>([]);
  readonly cortexState = signal<CortexState>('none');
  readonly cortexMessage = signal('');
  readonly canRetry = signal(false);
  readonly summary = signal('');
  readonly droppedNote = signal('');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly pane = signal<'before' | 'after'>('after');
  readonly paneOptions: SegmentedOption<'before' | 'after'>[] = [{ value: 'before', label: 'Before' }, { value: 'after', label: 'After' }];

  readonly rules = computed(() => this.result()?.changes ?? []);
  readonly all = computed(() => [...this.rules(), ...this.cortexList()]);
  readonly chosen = computed(() => this.all().filter(c => this.selected().has(c.id)));
  readonly selectedCount = computed(() => this.chosen().length);

  private urls: { before: string | null; after: string | null } = { before: null, after: null };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Run the plain rules once the inputs are there (after a paint, so "Checking…" shows).
    effect(() => {
      const tpl = this.tpl(), base = this.base();
      untracked(() => { setTimeout(() => this.start(tpl, base), 30); });
    });
    // Before: rendered once, from the template as it stands.
    effect(() => {
      if (this.phase() !== 'ready') return;
      const frame = this.beforeFrame()?.nativeElement;
      if (!frame) return;
      untracked(() => this.show('before', frame, { ...this.base(), template: this.tpl() }));
    });
    // After: re-rendered (debounced) whenever the ticks change.
    effect(() => {
      if (this.phase() !== 'ready') return;
      const frame = this.afterFrame()?.nativeElement;
      const patch = this.afterPatch();
      if (!frame) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show('after', frame, { ...this.base(), template: { ...this.tpl(), ...patch } as ReportTemplate }), 200);
    });
    effect(() => { if (this.phase() === 'ready') untracked(() => this.dlg()?.nativeElement.focus()); });
  }

  private readonly afterPatch = computed(() => {
    const r = this.result();
    return r ? applyChanges(this.tpl(), this.chosen(), r.base) : {};
  });

  private start(tpl: ReportTemplate, base: Omit<ReportPdfInput, 'template'>) {
    let res: TidyResult;
    try {
      res = runTidy(tpl, makeTidyProbe(base), { flagsColoured: tpl.flagStyle === 'bold_color' });
    } catch (e) {
      console.error('tidy failed', e);
      res = { changes: [], choices: [], base: {}, findings: [], applied: [], issuesBefore: 0 };
    }
    this.result.set(res);
    this.selected.set(new Set(res.changes.map(c => c.id)));
    this.phase.set('ready');
    if (this.withCortex() && res.choices.length) { this.cortexState.set('loading'); void this.askCortex(); }
  }

  async askCortex() {
    const res = this.result();
    if (!res) return;
    this.cortexState.set('loading');
    this.canRetry.set(false);
    try {
      const providers = await firstValueFrom(this.api.reportTidyProviders());
      const provider = pickProvider(providers, null);
      if (!provider) { this.cortexState.set('error'); this.cortexMessage.set('Cortex isn’t available right now. The plain fixes above still work.'); return; }
      const answer = await firstValueFrom(this.api.reportTidy(buildTidyRequest(provider, this.tpl(), res)));
      const { changes, dropped } = cortexChanges(answer as never, this.tpl(), res);
      this.cortexList.set(changes);
      this.summary.set(answer.summary);
      const n = dropped.length + answer.dropped;
      this.droppedNote.set(n ? `${n} ${n === 1 ? 'suggestion was' : 'suggestions were'} left out because ${n === 1 ? 'it' : 'they'} didn’t fit the report’s rules.` : '');
      this.selected.update(s => new Set([...s, ...changes.map(c => c.id)]));
      this.cortexState.set('done');
    } catch (e) {
      const v = assistantError(e, 'Cortex');
      this.sense.noteRefusal(String((e as { error?: { error?: string } })?.error?.error ?? ''));
      this.cortexState.set('error');
      this.cortexMessage.set(`${v.message} The plain fixes above still work.`);
      this.canRetry.set(v.retry);
    }
  }

  tick(id: string, on: boolean) { this.selected.set(toggleChange(this.selected(), id, on, this.all())); }

  apply() {
    const r = this.result();
    if (!r || !this.chosen().length) return;
    this.applied.emit(applyChanges(this.tpl(), this.chosen(), r.base));
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.close.emit(); }

  private show(which: 'before' | 'after', frame: HTMLIFrameElement, input: ReportPdfInput) {
    try {
      const url = renderReportPdfBlobUrl(input);
      const prev = this.urls[which];
      this.urls[which] = url;
      frame.contentWindow?.location.replace(url + '#view=FitH&toolbar=0');
      if (prev) setTimeout(() => URL.revokeObjectURL(prev), 1500);
    } catch (e) { console.error('tidy preview failed', e); }
  }

  ngOnDestroy() {
    if (this.timer) clearTimeout(this.timer);
    for (const u of Object.values(this.urls)) if (u) URL.revokeObjectURL(u);
  }
}
