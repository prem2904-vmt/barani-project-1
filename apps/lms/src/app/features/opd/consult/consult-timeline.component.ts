import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

/** One of today's four consult steps as the timeline shows it. */
export interface TimelineStepView { n: 1 | 2 | 3 | 4; title: string; summary: string; warn?: boolean; done: boolean; current: boolean; }

export type HistoryType = 'visit' | 'result' | 'rx' | 'file';
/** One dated entry of the patient's history. */
export interface HistoryNode {
  id: string; type: HistoryType; date: string; title: string; sub?: string | null;
  /** Abnormal (a result with a flagged value). */
  flag?: boolean;
  /** The short summary shown when the node is expanded. */
  lines: string[];
  /** The patient journey's day key (yyyy-mm-dd, local) — Open / Compare land there. */
  dayKey?: string | null;
  canCompare?: boolean;
}

export type HistoryFilter = 'all' | HistoryType;

const TYPE_LABEL: Record<HistoryType, string> = { visit: 'Visit', result: 'Lab result', rx: 'Prescription', file: 'File' };

/** Newest first, then the filter. Pure. */
export function filterHistory(nodes: readonly HistoryNode[], f: HistoryFilter): HistoryNode[] {
  return nodes.filter(n => f === 'all' || n.type === f).slice().sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The consult's left TIMELINE card (owner 2026-10-03): ONE vertical timeline,
 * newest first. The top node is TODAY — this consult, its four steps as
 * sub-nodes (done / current, a one-line summary; tap = go there). Below it the
 * patient's dated history — visits, lab results (abnormal flagged),
 * prescriptions and files — each with its own icon + dot, expanding in place
 * to a short summary with Open / Compare. Filter chips: All · Visits ·
 * Results · Rx · Files. `slim` (tablets) collapses it to an icon rail.
 */
@Component({
  selector: 'pf-consult-timeline',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="nd-card__head ct__head">
      <span class="nd-card__icon" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10"/><path d="M11 5h9M11 12h9M11 19h9"/><circle cx="6" cy="12" r="2"/></svg>
      </span>
      @if (!slim()) { <span class="nd-card__label">Timeline</span> }
      @if (slim()) {
        <button type="button" class="ct__expand" (click)="expand.emit()" aria-label="Open the full timeline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      }
    </header>

    @if (slim()) {
      <!-- Tablet: a slim rail — today's four steps, then one dot per history type. -->
      <nav class="ct__rail" aria-label="Consult steps">
        @for (s of steps(); track s.n) {
          <button type="button" class="ct__railstep" [class.on]="s.current" [class.done]="s.done" (click)="go.emit(s.n)"
                  [attr.aria-current]="s.current ? 'step' : null" [attr.aria-label]="'Step ' + s.n + ': ' + s.title + ' — ' + s.summary" [title]="s.title">
            @if (s.done && !s.current) { <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> }
            @else { {{ s.n }} }
          </button>
        }
        <span class="ct__railsep" aria-hidden="true"></span>
        @for (t of railTypes(); track t.type) {
          <button type="button" class="ct__railtype" [attr.data-type]="t.type" (click)="filter.set(t.type); expand.emit()"
                  [attr.aria-label]="t.label + ': ' + t.count" [title]="t.label + ' · ' + t.count">
            <span class="ct__ico" [attr.data-type]="t.type" aria-hidden="true"></span>
            <span class="ct__railn nd-num">{{ t.count }}</span>
          </button>
        }
      </nav>
    } @else {
      <div class="ct__chips" role="group" aria-label="Show">
        @for (c of chips; track c.id) {
          <button type="button" class="nd-chip ct__chip" [attr.aria-pressed]="filter() === c.id" (click)="filter.set(c.id)" [attr.data-filter]="c.id">
            @if (c.id !== 'all') { <span class="ct__dot" [attr.data-type]="c.id" aria-hidden="true"></span> }
            {{ c.label }}@if (count(c.id); as n) { <span class="ct__chipn nd-num">{{ n }}</span> }
          </button>
        }
      </div>

      <ol class="ct__list" aria-label="Patient timeline">
        <!-- TODAY: this consult and its four steps -->
        @if (filter() === 'all') {
          <li class="ct__node ct__node--today" data-today>
            <span class="ct__pin ct__pin--today" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>
            </span>
            <div class="ct__body">
              <div class="ct__when"><b>Today</b><span class="nd-num">{{ visitDate() | date:'EEE, d MMM' }}</span></div>
              <div class="ct__title">This consult</div>
              <ol class="ct__steps">
                @for (s of steps(); track s.n) {
                  <li>
                    <button type="button" class="ct__step" [class.on]="s.current" [class.done]="s.done" (click)="go.emit(s.n)" [attr.aria-current]="s.current ? 'step' : null" [attr.data-step]="s.n">
                      <span class="ct__stepdot" aria-hidden="true">
                        @if (s.done && !s.current) { <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> }
                      </span>
                      <span class="ct__stepb">
                        <span class="ct__stept">{{ s.title }}</span>
                        <span class="ct__steps2" [class.warn]="s.warn">
                          @if (s.warn) { <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/></svg> }
                          {{ s.summary }}
                        </span>
                      </span>
                    </button>
                  </li>
                }
              </ol>
            </div>
          </li>
        }

        @for (n of shown(); track n.id) {
          <li class="ct__node" [attr.data-type]="n.type" [class.ct__node--open]="openId() === n.id" data-node>
            <span class="ct__pin" [attr.data-type]="n.type" [class.ct__pin--flag]="n.flag" aria-hidden="true">
              @switch (n.type) {
                @case ('visit') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/></svg> }
                @case ('result') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/></svg> }
                @case ('rx') { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="m9 9 6 6"/></svg> }
                @default { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> }
              }
            </span>
            <div class="ct__body">
              <button type="button" class="ct__row" (click)="toggle(n.id)" [attr.aria-expanded]="openId() === n.id">
                <span class="ct__when"><b class="nd-num">{{ n.date | date:'d MMM y' }}</b><span>{{ typeLabel(n.type) }}</span>
                  @if (n.flag) { <span class="ct__abn">Abnormal</span> }
                </span>
                <span class="ct__title">{{ n.title }}</span>
                @if (n.sub) { <span class="ct__sub">{{ n.sub }}</span> }
              </button>
              @if (openId() === n.id) {
                <div class="ct__more">
                  @for (l of n.lines; track $index) { <p>{{ l }}</p> }
                  <div class="ct__acts">
                    <button type="button" class="nd-btn nd-btn--secondary ct__act" (click)="open.emit(n)">Open</button>
                    @if (n.canCompare) { <button type="button" class="nd-btn nd-btn--tertiary ct__act" (click)="compare.emit(n)">Compare</button> }
                  </div>
                </div>
              }
            </div>
          </li>
        } @empty {
          @if (filter() !== 'all') { <li class="ct__empty">Nothing here yet.</li> }
          @else if (!loading()) { <li class="ct__empty">No earlier visits, results or files — this is the first record.</li> }
        }
        @if (loading()) { <li class="ct__empty">Loading the history…</li> }
      </ol>
    }
  `,
  styles: [`
    :host {
      display: flex; flex-direction: column; min-height: 0; height: 100%;
      --ct-visit: var(--violet-text, #6d28d9); --ct-result: #0284c7; --ct-rx: #c2410c; --ct-file: #64748b; --ct-red: var(--red-text, #dc2626);
    }
    :host-context(html.dark), :host-context([data-theme='dark']) { --ct-result: #38bdf8; --ct-rx: #fb923c; --ct-file: #94a3b8; }
    .ct__head { flex: none; }
    .ct__expand { margin-left: auto; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); display: inline-grid; place-items: center; cursor: pointer; }
    .ct__expand:hover { background: var(--nd-chip-bg); }

    .ct__chips { flex: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 10px; border-bottom: 1px solid var(--nd-line); }
    .ct__chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; font-size: 12.5px; }
    .ct__chipn { font-size: 11px; color: var(--text-tertiary); }
    .ct__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ct-file); }
    .ct__dot[data-type='visit'] { background: var(--ct-visit); }
    .ct__dot[data-type='result'] { background: var(--ct-result); }
    .ct__dot[data-type='rx'] { background: var(--ct-rx); }

    .ct__list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; list-style: none; margin: 0; padding: 14px 14px 20px;
      scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb, rgba(168, 85, 247, 0.32)) transparent; }
    .ct__node { position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 0 10px; padding-bottom: 14px; }
    /* The spine: a hairline from each pin down to the next. */
    .ct__node::before { content: ''; position: absolute; left: 11.5px; top: 26px; bottom: 0; width: 1px; background: var(--nd-line); }
    .ct__node:last-child::before { display: none; }
    .ct__pin { position: relative; z-index: 1; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
      color: var(--ct-file); background: color-mix(in srgb, var(--ct-file) 14%, var(--nd-card-bg)); box-shadow: 0 0 0 3px var(--nd-card-bg); }
    .ct__pin[data-type='visit'] { color: var(--ct-visit); background: color-mix(in srgb, var(--ct-visit) 14%, var(--nd-card-bg)); }
    .ct__pin[data-type='result'] { color: var(--ct-result); background: color-mix(in srgb, var(--ct-result) 14%, var(--nd-card-bg)); }
    .ct__pin[data-type='rx'] { color: var(--ct-rx); background: color-mix(in srgb, var(--ct-rx) 14%, var(--nd-card-bg)); }
    .ct__pin--flag::after { content: ''; position: absolute; top: -1px; right: -1px; width: 8px; height: 8px; border-radius: 50%; background: var(--ct-red); box-shadow: 0 0 0 2px var(--nd-card-bg); }
    .ct__pin--today { color: #fff; background: var(--color-violet-600, #7c3aed); box-shadow: 0 0 0 3px var(--nd-card-bg), 0 0 0 6px color-mix(in srgb, var(--color-primary, #7c3aed) 18%, transparent); }
    .ct__body { min-width: 0; display: flex; flex-direction: column; }
    .ct__row { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 2px 8px 6px; margin: 0 -8px; border: 0; border-radius: 10px; background: transparent;
      color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .ct__row:hover { background: var(--nd-chip-bg); }
    .ct__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 0; }
    .ct__when { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-height: 24px; font-size: 11.5px; color: var(--text-tertiary); }
    .ct__when b { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .ct__abn { padding: 0 6px; border-radius: 5px; font-size: 10.5px; font-weight: 600; color: var(--ct-red); background: color-mix(in srgb, var(--ct-red) 10%, transparent); }
    .ct__title { font-size: 13.5px; font-weight: 600; line-height: 1.35; color: var(--text-primary); overflow-wrap: anywhere; }
    .ct__sub { font-size: 12px; line-height: 1.4; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .ct__more { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 2px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--text-primary) 3%, transparent);
      border: 1px solid var(--nd-line); animation: ct-in 180ms var(--nd-spring, ease) both; }
    .ct__more p { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-secondary); overflow-wrap: anywhere; }
    .ct__acts { display: flex; gap: 8px; margin-top: 6px; }
    .ct__act { height: 32px; padding: 0 12px; font-size: 12.5px; }
    @keyframes ct-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }

    /* TODAY + its steps */
    .ct__node--today { padding-bottom: 18px; }
    .ct__node--today .ct__when b { color: var(--violet-text, #6d28d9); text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; }
    .ct__steps { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .ct__step { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; width: 100%; padding: 8px 10px 8px 8px; border: 1px solid transparent; border-radius: 10px;
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
      transition: background var(--nd-dur-fast, 200ms) ease, border-color var(--nd-dur-fast, 200ms) ease; }
    .ct__step:hover { background: var(--nd-chip-bg); }
    .ct__step.on { background: var(--nd-in-tint); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 30%, transparent); }
    .ct__step:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .ct__stepdot { margin-top: 2px; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--nd-sel-border); background: var(--nd-card-bg); color: #fff; }
    .ct__step.done .ct__stepdot { border-color: transparent; background: var(--color-violet-600, #7c3aed); }
    .ct__step.on .ct__stepdot { border-color: var(--color-violet-600, #7c3aed); box-shadow: inset 0 0 0 3px var(--nd-card-bg); background: var(--color-violet-600, #7c3aed); }
    .ct__stepb { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .ct__stept { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .ct__step:not(.on) .ct__stept { font-weight: 500; }
    .ct__steps2 { font-size: 12px; line-height: 1.4; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .ct__steps2.warn { color: var(--ct-red); }
    .ct__steps2 svg { vertical-align: -1px; margin-right: 2px; }
    .ct__empty { padding: 4px 0 0 34px; font-size: 12.5px; color: var(--text-tertiary); }

    /* Slim rail (tablet) */
    .ct__rail { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0; }
    .ct__railstep { width: 36px; height: 36px; border-radius: 50%; border: 1.5px solid var(--nd-sel-border); background: var(--nd-card-bg); color: var(--text-secondary);
      font: inherit; font-size: 13px; font-weight: 600; display: grid; place-items: center; cursor: pointer; }
    .ct__railstep.done { background: var(--color-violet-600, #7c3aed); border-color: transparent; color: #fff; }
    .ct__railstep.on { border-color: var(--color-violet-600, #7c3aed); color: var(--violet-text, #6d28d9); background: var(--nd-in-tint); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .ct__railsep { width: 20px; height: 1px; margin: 4px 0; background: var(--nd-line); }
    .ct__railtype { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 44px; padding: 6px 0; border: 0; border-radius: 10px; background: transparent; cursor: pointer; color: var(--text-tertiary); font: inherit; }
    .ct__railtype:hover { background: var(--nd-chip-bg); }
    .ct__ico { width: 10px; height: 10px; border-radius: 50%; background: var(--ct-file); }
    .ct__ico[data-type='visit'] { background: var(--ct-visit); }
    .ct__ico[data-type='result'] { background: var(--ct-result); }
    .ct__ico[data-type='rx'] { background: var(--ct-rx); }
    .ct__railn { font-size: 11px; }
    @media (prefers-reduced-motion: reduce) { .ct__more { animation: none; } .ct__step { transition: none; } }
    @media (pointer: coarse) { .ct__step, .ct__row { min-height: 44px; } .ct__chip { height: 36px; } }
  `],
})
export class ConsultTimelineComponent {
  readonly steps = input<TimelineStepView[]>([]);
  readonly nodes = input<HistoryNode[]>([]);
  readonly visitDate = input<string>('');
  readonly slim = input(false);
  readonly loading = input(false);

  readonly go = output<1 | 2 | 3 | 4>();
  readonly open = output<HistoryNode>();
  readonly compare = output<HistoryNode>();
  readonly expand = output<void>();

  readonly filter = signal<HistoryFilter>('all');
  readonly openId = signal<string | null>(null);
  readonly chips: { id: HistoryFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'visit', label: 'Visits' }, { id: 'result', label: 'Results' }, { id: 'rx', label: 'Rx' }, { id: 'file', label: 'Files' },
  ];
  readonly shown = computed(() => filterHistory(this.nodes(), this.filter()));
  readonly railTypes = computed(() => (['visit', 'result', 'rx', 'file'] as HistoryType[])
    .map(t => ({ type: t, label: this.chips.find(c => c.id === t)!.label, count: this.count(t) })).filter(t => t.count > 0));

  count(f: HistoryFilter): number { return f === 'all' ? 0 : this.nodes().filter(n => n.type === f).length; }
  typeLabel(t: HistoryType) { return TYPE_LABEL[t]; }
  toggle(id: string) { this.openId.update(cur => (cur === id ? null : id)); }
}
