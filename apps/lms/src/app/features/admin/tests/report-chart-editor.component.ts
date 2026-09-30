import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ReportChartComponent } from '../../../shared/components/report-chart/report-chart.component';
import { buildChartData, prettyName } from '../../../shared/utils/report-chart/report-chart.data';
import {
  CHART_KINDS, isPercentUnit, kindAvailability, kindSupports, MAX_LINES, MAX_PARAMETERS, MAX_THRESHOLDS, normalizeChartSpec, offsetTickLabel,
  type ChartKind, type ChartLineSpec, type ChartSetSpec, type ReportChartSpec,
} from '../../../shared/utils/report-chart/report-chart.model';
import {
  autoCompareSet, autoSecondLine, chartShape, sampleChartTests, seriesUnits, type ChartEditorContext,
} from '../../../shared/utils/report-chart/report-chart.sample';

/**
 * The chart block's editor (Test Master → Printed report → Chart), with a
 * live preview drawn from sample values by the SAME geometry the PDF uses.
 * Stateless: every change emits the whole normalised spec; the host
 * (pf-report-structure) stores it in the layout section and autosaves.
 * docs/REPORT-CHARTS.md §1.
 */
@Component({
  selector: 'pf-report-chart-editor',
  standalone: true,
  imports: [SelectComponent, ReportChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = spec();
    <div class="rce">
      <div class="rce__form">
        <label class="nd-field rce__title">
          <span class="nd-field__lbl">Title</span>
          <input class="nd-input" type="text" maxlength="80" [value]="title()" placeholder="e.g. Glucose curve"
                 (change)="titleChange.emit($any($event.target).value)" />
        </label>

        <div class="rce__row">
          <span class="nd-field__lbl">Across</span>
          <div class="nd-seg" role="radiogroup" aria-label="X axis">
            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s.x === 'series'"
                    [disabled]="!context().series" (click)="setX('series')"
                    [title]="context().series ? 'The timed draws of this series' : 'Turn on Repetitive (timed series) to chart time points'">Time points</button>
            <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s.x === 'parameters'"
                    (click)="setX('parameters')">Chosen values</button>
          </div>
        </div>

        <div class="rce__group rce__group--kinds">
          <span class="rce__sub">Chart type <span class="rce__note">{{ kindLabel() }}</span></span>
          <div class="rce__kinds" role="radiogroup" aria-label="Chart type">
            @for (k of kindCards(); track k.value) {
              <button type="button" class="nd-tile-sel rce__kind" role="radio" [attr.aria-checked]="s.kind === k.value"
                      [attr.aria-disabled]="!k.ok" [class.rce__kind--off]="!k.ok" [disabled]="!k.ok"
                      [attr.aria-label]="k.label + (k.ok ? '' : ' — ' + k.reason)" (click)="setKind(k.value)">
                <span class="rce__kthumb" aria-hidden="true">
                  <pf-report-chart [data]="k.data" [thumb]="true" [contentWidth]="220" [class.pfrc-muted]="!k.ok"></pf-report-chart>
                </span>
                @if (s.kind === k.value) {
                  <span class="rce__kcheck" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                }
                <span class="rce__kname">{{ k.label }}</span>
                @if (!k.ok) { <span class="rce__kwhy">{{ k.reason }}</span> }
              </button>
            }
          </div>
        </div>

        @if (s.x === 'series') {
          <div class="rce__group">
            <span class="rce__sub">Time points</span>
            <div class="rce__tps">
              @for (tp of context().timepoints; track tp.offsetMin) {
                <label class="rce__tp">
                  <span class="rce__tpk nd-num">{{ tp.offsetMin === 0 ? '0' : '+' + tp.offsetMin }} min</span>
                  <input class="nd-input rce__tpin" type="text" maxlength="30" [value]="tickLabel(tp.offsetMin)"
                         [attr.aria-label]="'Label for ' + tp.offsetMin + ' min'"
                         (change)="setTick(tp.offsetMin, $any($event.target).value)" />
                </label>
              }
            </div>
          </div>
          <div class="rce__group">
            <span class="rce__sub">Lines</span>
            @for (l of s.lines ?? []; track $index; let li = $index) {
              <div class="rce__line">
                <span class="rce__swatch" [class.rce__swatch--2]="li > 0" aria-hidden="true"></span>
                <div class="rce__linesel">
                  <pf-select size="sm" [options]="unitOptions()" [value]="l.unit || ''"
                             (valueChange)="setLine(li, { unit: $any($event) || null })"></pf-select>
                </div>
                <input class="nd-input rce__match" type="text" maxlength="40" [value]="l.match || ''"
                       placeholder="only names with…" [attr.aria-label]="'Line ' + (li + 1) + ': only values whose name contains'"
                       (change)="setLine(li, { match: $any($event.target).value || null })" />
                @if (li > 0) {
                  <button type="button" class="nd-btn nd-btn--icon rce__x" (click)="removeLine(li)" aria-label="Remove this line" title="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                }
              </div>
            }
            @if (droppedLines().length) {
              <p class="nd-field__hint rce__warn">Not drawn: {{ droppedLines().join(', ') }} — two units at most (one axis on each side).</p>
            }
            @if ((s.lines?.length ?? 0) < maxLines) {
              <button type="button" class="rce__add" (click)="addLine()">+ Add a line</button>
              <p class="nd-field__hint">Up to {{ maxLines }} lines. A line in a different unit gets its own axis on the right.</p>
            }
          </div>
        } @else {
          <div class="rce__group">
            <span class="rce__sub">{{ s.kind === 'gauge' ? 'Value' : 'Values' }}
              @if (s.kind !== 'gauge') { <span class="rce__count nd-num">{{ (s.parameters ?? []).length }} / {{ maxParams }}</span> }</span>
            @if (context().params.length === 0) {
              <p class="nd-field__hint">This test has no numeric values to chart yet.</p>
            }
            @if (s.kind === 'gauge') { <p class="nd-field__hint">A gauge shows one value against its normal range — pick it.</p> }
            @if (s.kind === 'pie' || s.kind === 'donut') { <p class="nd-field__hint">Parts of a whole: only values in % can be ticked.</p> }
            @if (s.kind === 'radar') { <p class="nd-field__hint">Pick 3 or more. Each spoke is scaled to its own upper normal limit.</p> }
            <div class="rce__params">
              @for (p of context().params; track p.name) {
                <label class="nd-row rce__param" [class.nd-row--in]="isPicked(p.name)" [class.rce__param--off]="!canPick(p)">
                  <input [type]="s.kind === 'gauge' ? 'radio' : 'checkbox'" class="rce__srcheck" name="rce-gauge-value"
                         [checked]="isPicked(p.name)" (change)="toggleParam(p.name)" [disabled]="!canPick(p)" />
                  <span class="nd-row__check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                  <span class="nd-row__name">{{ p.title || pretty(p.name) }}</span>
                  @if (p.unit) { <span class="nd-row__meta">{{ p.unit }}</span> }
                </label>
              }
            </div>
          </div>
          @if (supports().sets) {
            <div class="rce__group">
              <span class="rce__sub">Compare with</span>
              @if ((s.sets ?? []).length === 0) {
                <p class="nd-field__hint">Add a second set of values to place next to each chosen value (e.g. the absolute counts next to the %).</p>
              }
              @for (set of s.sets ?? []; track $index; let si = $index) {
                <div class="rce__set">
                  <div class="rce__sethead">
                    <span class="rce__swatch rce__swatch--box" [attr.data-i]="si + 1" aria-hidden="true"></span>
                    <input class="nd-input rce__setname" type="text" maxlength="40" [value]="set.label || ''" placeholder="Set name, e.g. Absolute"
                           [attr.aria-label]="'Set ' + (si + 2) + ' name'" (change)="setSet(si, { label: $any($event.target).value || null })" />
                    <button type="button" class="nd-btn nd-btn--icon rce__x" (click)="removeSet(si)" aria-label="Remove this set" title="Remove">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                  @for (name of s.parameters ?? []; track name; let pi = $index) {
                    <div class="rce__setrow">
                      <span class="rce__setcat">{{ titleOf(name) }}</span>
                      <div class="rce__setsel">
                        <pf-select size="sm" [options]="setOptions()" [value]="set.parameters[pi] || ''"
                                   (valueChange)="setSetParam(si, pi, $any($event) || null)"></pf-select>
                      </div>
                    </div>
                  }
                </div>
              }
              @if ((s.sets ?? []).length < maxLines - 1 && (s.parameters ?? []).length > 0) {
                <button type="button" class="rce__add" (click)="addSet()">+ Add a set to compare</button>
              }
              @if ((s.sets ?? []).length) {
                <label class="nd-field">
                  <span class="nd-field__lbl">Name of the chosen values (legend)</span>
                  <input class="nd-input" type="text" maxlength="40" [value]="s.mainLabel || ''" placeholder="e.g. Percent"
                         (change)="patch({ mainLabel: $any($event.target).value || null })" />
                </label>
              }
            </div>
          }
        }

        <div class="rce__group">
          <span class="rce__sub">Reference</span>
          @if (supports().band) {
            <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s.refBand" (click)="patch({ refBand: !s.refBand })">
              <span class="nd-toggle__track"><span class="nd-toggle__knob"></span></span>
              Shade the normal range (the patient's own band)
            </button>
          } @else {
            <p class="nd-field__hint">{{ noBandHint() }}</p>
          }
          @if (supports().thresholds) {
          @for (t of s.thresholds; track $index; let ti = $index) {
            <div class="rce__thr">
              <input class="nd-input rce__thrv nd-num" type="text" inputmode="decimal" [value]="t.value"
                     [attr.aria-label]="'Threshold ' + (ti + 1) + ' value'" (change)="setThreshold(ti, { value: $any($event.target).value })" />
              <input class="nd-input" type="text" maxlength="60" [value]="t.label || ''" placeholder="Label, e.g. Diabetes ≥ 200 at 2 h"
                     [attr.aria-label]="'Threshold ' + (ti + 1) + ' label'" (change)="setThreshold(ti, { label: $any($event.target).value })" />
              <button type="button" class="nd-btn nd-btn--icon rce__x" (click)="removeThreshold(ti)" aria-label="Remove this line" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          }
          @if (s.thresholds.length < maxThresholds) {
            <button type="button" class="rce__add" (click)="addThreshold()">+ Add a threshold {{ s.kind === 'gauge' ? 'mark' : 'line' }}</button>
          }
          }
        </div>

        <div class="rce__group">
          <span class="rce__sub">Look</span>
          <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s.showValues" (click)="patch({ showValues: !s.showValues })">
            <span class="nd-toggle__track"><span class="nd-toggle__knob"></span></span>
            Show the values on the chart
          </button>
          <div class="rce__row">
            <span class="nd-field__lbl">Size</span>
            <div class="nd-seg" role="radiogroup" aria-label="Size">
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s.size === 'full'" (click)="patch({ size: 'full' })">Full width</button>
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s.size === 'half'" (click)="patch({ size: 'half' })">Half width</button>
            </div>
          </div>
          @if (supports().axis) {
          <div class="rce__row">
            <span class="nd-field__lbl">{{ s.kind === 'gauge' ? 'Dial from' : 'Axis from' }}</span>
            <input class="nd-input rce__ax nd-num" type="text" inputmode="decimal" placeholder="auto" [value]="s.yMin ?? ''"
                   aria-label="Axis from" (change)="patch({ yMin: $any($event.target).value })" />
            <span class="nd-field__lbl">to</span>
            <input class="nd-input rce__ax nd-num" type="text" inputmode="decimal" placeholder="auto" [value]="s.yMax ?? ''"
                   aria-label="Axis to" (change)="patch({ yMax: $any($event.target).value })" />
          </div>
          }
        </div>
      </div>

      <div class="rce__preview">
        <span class="rce__sub">Preview <span class="rce__note">sample values</span></span>
        <!-- Laid out a little narrower than the A4 column so its labels read
             at screen size; the geometry is the one the PDF draws. -->
        <pf-report-chart [data]="preview()" [contentWidth]="440"></pf-report-chart>
      </div>
    </div>
  `,
  styles: [`
    .rce { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
    @container (min-width: 760px) { .rce { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); } }
    :host { display: block; container-type: inline-size; }
    .rce__form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .rce__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rce__row .nd-field__lbl { min-width: 52px; }
    .rce__group { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--nd-line, var(--glass-border)); }
    .rce__sub { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .rce__count, .rce__note { font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 6px; }
    .rce__tps { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .rce__tp { display: flex; align-items: center; gap: 8px; }
    .rce__tpk { flex: none; min-width: 58px; font-size: 12px; color: var(--text-secondary); }
    .rce__tpin, .rce__ax { min-height: 36px; }
    .rce__ax { width: 90px; }
    .rce__line, .rce__thr { display: flex; align-items: center; gap: 8px; }
    .rce__linesel { flex: 0 0 150px; }
    .rce__match { flex: 1 1 auto; min-height: 36px; }
    .rce__thr .nd-input { min-height: 36px; }
    .rce__thrv { flex: 0 0 84px; }
    .rce__swatch { flex: none; width: 18px; height: 0; border-top: 2px solid var(--color-primary, #7c3aed); }
    .rce__swatch--2 { border-top: 2px dashed var(--text-secondary); }
    .rce__x { flex: none; }
    .rce .nd-toggle { white-space: normal; text-align: left; line-height: 1.35; min-height: 32px; }
    /* One column: the preview comes first, so the author sees the chart. */
    @container (max-width: 759px) { .rce__preview { order: -1; } }
    .rce__add { align-self: flex-start; background: none; border: none; padding: 4px 0; font: inherit; font-size: 12.5px;
      font-weight: 600; color: var(--violet-text, #7c3aed); cursor: pointer; }
    .rce__params { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
    .rce__param { min-height: 44px; cursor: pointer; position: relative; }
    .rce__srcheck { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
    .rce__param:focus-within { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 1px; }
    .rce__preview { display: flex; flex-direction: column; gap: 8px; min-width: 0; align-self: start; }
    /* Chart-type picker: one visual card per type, live thumbnail of the
       test's own sample values; a type that does not fit the data is
       disabled with its one-line reason. */
    .rce__kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
    .rce__kind { display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-height: 44px; padding: 6px 6px 8px;
      border: 1px solid var(--nd-line, var(--glass-border)); border-radius: 10px; background: var(--nd-card-bg, transparent);
      color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .rce__kind { position: relative; }
    .rce__kind[aria-checked="true"] { border-color: var(--nd-sel-border, var(--text-primary)); box-shadow: inset 0 0 0 1px var(--nd-sel-border, var(--text-primary)); }
    .rce__kcheck { position: absolute; top: 4px; right: 4px; display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 50%; background: var(--text-primary); color: var(--nd-card-bg, #fff); }
    .rce__kind:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 2px; }
    .rce__kthumb { display: block; height: 58px; border-radius: 6px; background: #fff; overflow: hidden;
      border: 1px solid rgba(15, 23, 42, .08); }
    .rce__kthumb pf-report-chart { display: block; height: 100%; }
    .rce__kind--off .rce__kthumb { height: 34px; }
    .rce__kind--off { padding-bottom: 6px; }
    .rce__kname { font-size: 12.5px; font-weight: 600; line-height: 1.25; }
    .rce__kwhy { font-size: 11px; line-height: 1.3; color: var(--text-tertiary); }
    .rce__kind--off { cursor: not-allowed; }
    .rce__kind--off .rce__kthumb { background: transparent; border-style: dashed; }
    .rce__kind--off .rce__kthumb pf-report-chart { opacity: .35; filter: grayscale(1); }
    .rce__kind--off .rce__kname { color: var(--text-secondary); }
    .rce__param--off { opacity: .5; cursor: not-allowed; }
    .rce__warn { color: var(--text-secondary); }
    .rce__set { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--nd-line, var(--glass-border)); border-radius: 10px; }
    .rce__sethead { display: flex; align-items: center; gap: 8px; }
    .rce__setname { flex: 1 1 auto; min-height: 36px; }
    .rce__setrow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 8px; align-items: center; }
    .rce__setcat { font-size: 12.5px; color: var(--text-secondary); overflow-wrap: anywhere; }
    .rce__swatch--box { width: 10px; height: 10px; border-top: 0; border-radius: 2px; background: var(--text-secondary); }
    .rce__swatch--box[data-i="1"] { background: #475569; }
    .rce__swatch--box[data-i="2"] { background: #8fb3e0; }
    .rce__swatch--box[data-i="3"] { background: #94a3b8; }
    @container (min-width: 760px) { .rce__preview { position: sticky; top: 8px; } }
    @media (max-width: 640px) {
      .rce .nd-input { font-size: 16px; min-height: 44px; }
      .rce .nd-seg__item { min-height: 40px; }
      .rce__linesel { flex-basis: 120px; }
      .rce__kinds { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
      .rce__kthumb { height: 50px; }
      .rce__setrow { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    }
  `],
})
export class ReportChartEditorComponent {
  /** The stored `trend` object (any shape — normalised here). */
  readonly value = input<unknown>(null);
  readonly title = input<string>('');
  readonly context = input.required<ChartEditorContext>();

  readonly specChange = output<ReportChartSpec>();
  readonly titleChange = output<string>();

  readonly kinds = CHART_KINDS;
  readonly maxLines = MAX_LINES;
  readonly maxThresholds = MAX_THRESHOLDS;
  readonly maxParams = MAX_PARAMETERS;
  pretty = prettyName;

  readonly spec = computed<ReportChartSpec>(() =>
    normalizeChartSpec(this.value()) ?? normalizeChartSpec({ x: this.context().series ? 'series' : 'parameters' })!);

  readonly supports = computed(() => kindSupports(this.spec().kind));
  readonly noBandHint = computed(() => this.spec().kind === 'pie' || this.spec().kind === 'donut'
    ? "The key beside the chart prints each value's normal range."
    : 'A stacked chart shows totals, so no normal band is shaded.');
  readonly shape = computed(() => chartShape(this.context(), this.spec().x));
  private readonly titles = computed(() =>
    Object.fromEntries(this.context().params.filter(p => p.title).map(p => [p.name, p.title as string])));
  private readonly samples = computed(() => sampleChartTests(this.context()));

  /** One card per chart type: availability for this test's data + a live
   *  thumbnail drawn from the test's sample values with the spec that
   *  choosing the card would save. */
  readonly kindCards = computed(() => {
    const ctx = this.context();
    const shape = this.shape();
    const cards = CHART_KINDS.map(k => {
      const a = kindAvailability(k.value, shape);
      const spec = this.specFor(k.value);
      return { ...k, ok: a.ok, reason: a.reason, data: buildChartData(spec, '', ctx.ownerId, this.samples(), this.titles()) };
    });
    // The types that fit this test first; the rest after, each with its reason.
    return [...cards.filter(c => c.ok), ...cards.filter(c => !c.ok)];
  });
  readonly kindLabel = computed(() => CHART_KINDS.find(k => k.value === this.spec().kind)?.label ?? '');

  /** Lines that will not print (a third unit has no axis). */
  readonly droppedLines = computed(() => {
    const s = this.spec();
    if (s.x !== 'series') return [];
    const d = this.preview();
    const drawn = new Set((d?.series ?? []).map(x => x.label));
    return (s.lines ?? []).map((l, i) => (l.label ?? '').trim() || (l.match ?? '').trim() || l.unit || `Line ${i + 1}`)
      .filter(l => !drawn.has(l));
  });

  readonly setOptions = computed<PfSelectOption[]>(() => [
    { value: '', label: '— nothing —' },
    ...this.context().params.map(p => ({ value: p.name, label: (p.title || prettyName(p.name)) + (p.unit ? ` (${p.unit})` : '') })),
  ]);

  readonly unitOptions = computed<PfSelectOption[]>(() => [
    { value: '', label: 'Main result' },
    ...seriesUnits(this.context()).map(u => ({ value: u, label: u })),
  ]);

  readonly preview = computed(() =>
    buildChartData(this.spec(), this.title() || 'Chart', this.context().ownerId, this.samples(), this.titles()));

  titleOf(name: string): string {
    const p = this.context().params.find(x => x.name.toLowerCase() === name.toLowerCase());
    return p?.title || prettyName(name);
  }

  /** The spec choosing `kind` saves: the data it needs is filled in (a gauge
   *  keeps one value, a pie only the % values, a radar at least three, a
   *  grouped / stacked / combination chart a second series). */
  specFor(kind: ChartKind): ReportChartSpec {
    const cur = this.spec();
    const ctx = this.context();
    const next: ReportChartSpec = { ...cur, kind };
    if (cur.x === 'series') {
      if ((kind === 'groupedBar' || kind === 'combo') && (cur.lines?.length ?? 0) < 2) next.lines = autoSecondLine(ctx, cur.lines ?? [{}], false);
      if (kind === 'stackedArea' || kind === 'stackedBar') next.lines = autoSecondLine(ctx, cur.lines ?? [{}], true);
      return normalizeChartSpec(next) ?? cur;
    }
    const chosen = cur.parameters ?? [];
    const all = ctx.params.map(p => p.name);
    if (kind === 'gauge') { next.parameters = [chosen[0] ?? all[0]].filter(Boolean) as string[]; next.sets = []; }
    else if (kind === 'pie' || kind === 'donut') {
      const pct = ctx.params.filter(p => isPercentUnit(p.unit)).map(p => p.name);
      const keep = chosen.filter(c => pct.some(p => p.toLowerCase() === c.toLowerCase()));
      next.parameters = (keep.length >= 2 ? keep : pct).slice(0, MAX_PARAMETERS);
      next.sets = [];
    } else if (kind === 'radar') {
      const list = [...chosen];
      for (const p of ctx.params) { if (list.length >= 3) break; if (!list.some(c => c.toLowerCase() === p.name.toLowerCase())) list.push(p.name); }
      next.parameters = list; next.sets = [];
    } else if (kindSupports(kind).sets && !(cur.sets ?? []).length && chosen.length) {
      const set = autoCompareSet(ctx, chosen);
      if (set.parameters.some(Boolean)) next.sets = [set];
    } else if (!kindSupports(kind).sets && kind !== 'bar') {
      next.sets = [];
    }
    return normalizeChartSpec(next) ?? cur;
  }

  setKind(kind: ChartKind) {
    if (kind === this.spec().kind) return;
    if (!kindAvailability(kind, this.shape()).ok) return;
    this.specChange.emit(this.specFor(kind));
  }

  canPick(p: { name: string; unit?: string | null }): boolean {
    const s = this.spec();
    if (this.isPicked(p.name)) return true;
    if ((s.kind === 'pie' || s.kind === 'donut') && !isPercentUnit(p.unit)) return false;
    if (s.kind === 'gauge') return true;
    return (s.parameters ?? []).length < MAX_PARAMETERS;
  }

  // Sets (x = chosen values): further values compared position by position.
  addSet() {
    const s = this.spec();
    const set = autoCompareSet(this.context(), s.parameters ?? []);
    this.patch({ sets: [...(s.sets ?? []), set.parameters.some(Boolean) ? set : { label: null, parameters: (s.parameters ?? []).map(() => null) }] });
  }
  setSet(i: number, p: Partial<ChartSetSpec>) {
    this.patch({ sets: (this.spec().sets ?? []).map((x, k) => k === i ? { ...x, ...p } : x) });
  }
  setSetParam(i: number, pos: number, name: string | null) {
    const set = (this.spec().sets ?? [])[i];
    if (!set) return;
    const ps = [...set.parameters];
    ps[pos] = name;
    this.setSet(i, { parameters: ps });
  }
  removeSet(i: number) { this.patch({ sets: (this.spec().sets ?? []).filter((_, k) => k !== i) }); }

  tickLabel(offset: number): string { return offsetTickLabel(offset, this.spec().xLabels); }

  patch(p: Partial<Record<keyof ReportChartSpec, unknown>>) {
    const next = normalizeChartSpec({ ...this.spec(), ...p });
    if (next) this.specChange.emit(next);
  }

  setX(x: 'series' | 'parameters') {
    if (x === this.spec().x) return;
    if (x === 'series') this.patch({ x, lines: [{}], kind: 'line', sets: undefined });
    else this.patch({ x, parameters: this.context().params.slice(0, 6).map(p => p.name), kind: 'bar' });
  }
  setTick(offset: number, label: string) {
    const labels = { ...(this.spec().xLabels ?? {}) };
    const v = label.trim();
    if (v && v !== offsetTickLabel(offset, null)) labels[String(offset)] = v; else delete labels[String(offset)];
    this.patch({ xLabels: labels });
  }
  setLine(i: number, p: Partial<ChartLineSpec>) {
    const lines = (this.spec().lines ?? [{}]).map((l, k) => k === i ? { ...l, ...p } : l);
    this.patch({ lines });
  }
  addLine() {
    const lines = this.spec().lines ?? [{}];
    const units = seriesUnits(this.context());
    // The next unit not yet on a line, else the main one (told apart by a name word).
    const unused = units.find(u => !lines.some(l => (l.unit ?? '').toLowerCase() === u.toLowerCase()));
    this.patch({ lines: [...lines, { unit: unused ?? units[0] ?? null }] });
  }
  removeLine(i: number) { this.patch({ lines: (this.spec().lines ?? []).filter((_, k) => k !== i) }); }

  isPicked(name: string): boolean { return (this.spec().parameters ?? []).some(p => p.toLowerCase() === name.toLowerCase()); }
  toggleParam(name: string) {
    if (this.spec().kind === 'gauge') { this.patch({ parameters: [name] }); return; }
    const cur = this.spec().parameters ?? [];
    if (this.isPicked(name)) { this.patch({ parameters: cur.filter(p => p.toLowerCase() !== name.toLowerCase()) }); return; }
    // Keep the test's own order, whatever order the ticks come in.
    const order = this.context().params.map(p => p.name.toLowerCase());
    const next = [...cur, name].sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()));
    this.patch({ parameters: next });
  }

  addThreshold() {
    const d = this.preview();
    const vals = d?.series.flatMap(s => s.points.map(p => p.high ?? p.value)).filter((v): v is number => v != null) ?? [];
    const guess = vals.length ? Math.round(Math.max(...vals)) : 100;
    this.patch({ thresholds: [...this.spec().thresholds, { value: guess, label: '' }] });
  }
  setThreshold(i: number, p: { value?: unknown; label?: string }) {
    // A value that is not a number is ignored (the box keeps the last good one).
    if (p.value !== undefined && !Number.isFinite(Number(String(p.value).trim().replace(',', '.')))) return;
    this.patch({ thresholds: this.spec().thresholds.map((t, k) => k === i ? { ...t, ...p } : t) });
  }
  removeThreshold(i: number) { this.patch({ thresholds: this.spec().thresholds.filter((_, k) => k !== i) }); }
}
