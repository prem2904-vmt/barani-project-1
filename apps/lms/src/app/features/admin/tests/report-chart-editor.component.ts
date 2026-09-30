import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ReportChartComponent } from '../../../shared/components/report-chart/report-chart.component';
import { buildChartData, prettyName } from '../../../shared/utils/report-chart/report-chart.data';
import {
  CHART_KINDS, MAX_LINES, MAX_PARAMETERS, MAX_THRESHOLDS, normalizeChartSpec, offsetTickLabel,
  type ChartLineSpec, type ReportChartSpec,
} from '../../../shared/utils/report-chart/report-chart.model';
import { sampleChartTests, seriesUnits, type ChartEditorContext } from '../../../shared/utils/report-chart/report-chart.sample';

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
          <span class="nd-field__lbl">Type</span>
          <div class="nd-seg" role="radiogroup" aria-label="Chart type">
            @for (k of kinds; track k.value) {
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="s.kind === k.value"
                      (click)="patch({ kind: k.value })">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  @switch (k.value) {
                    @case ('line') { <path d="M3 17l6-6 4 4 8-8"/> }
                    @case ('bar') { <path d="M6 20V10M12 20V4M18 20v-7"/> }
                    @case ('dots') { <circle cx="6" cy="15" r="1.6"/><circle cx="12" cy="8" r="1.6"/><circle cx="18" cy="12" r="1.6"/> }
                  }
                </svg>
                {{ k.label }}
              </button>
            }
          </div>
        </div>

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
            @if ((s.lines?.length ?? 0) < maxLines) {
              <button type="button" class="rce__add" (click)="addLine()">+ Add a second line</button>
              <p class="nd-field__hint">A second line in a different unit gets its own axis on the right.</p>
            }
          </div>
        } @else {
          <div class="rce__group">
            <span class="rce__sub">Values <span class="rce__count nd-num">{{ (s.parameters ?? []).length }} / {{ maxParams }}</span></span>
            @if (context().params.length === 0) {
              <p class="nd-field__hint">This test has no numeric values to chart yet.</p>
            }
            <div class="rce__params">
              @for (p of context().params; track p.name) {
                <label class="nd-row rce__param" [class.nd-row--in]="isPicked(p.name)">
                  <input type="checkbox" class="rce__srcheck" [checked]="isPicked(p.name)" (change)="toggleParam(p.name)"
                         [disabled]="!isPicked(p.name) && (s.parameters ?? []).length >= maxParams" />
                  <span class="nd-row__check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                  <span class="nd-row__name">{{ p.title || pretty(p.name) }}</span>
                  @if (p.unit) { <span class="nd-row__meta">{{ p.unit }}</span> }
                </label>
              }
            </div>
          </div>
        }

        <div class="rce__group">
          <span class="rce__sub">Reference</span>
          <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="s.refBand" (click)="patch({ refBand: !s.refBand })">
            <span class="nd-toggle__track"><span class="nd-toggle__knob"></span></span>
            Shade the normal range (the patient's own band)
          </button>
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
            <button type="button" class="rce__add" (click)="addThreshold()">+ Add a threshold line</button>
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
          <div class="rce__row">
            <span class="nd-field__lbl">Axis from</span>
            <input class="nd-input rce__ax nd-num" type="text" inputmode="decimal" placeholder="auto" [value]="s.yMin ?? ''"
                   aria-label="Axis from" (change)="patch({ yMin: $any($event.target).value })" />
            <span class="nd-field__lbl">to</span>
            <input class="nd-input rce__ax nd-num" type="text" inputmode="decimal" placeholder="auto" [value]="s.yMax ?? ''"
                   aria-label="Axis to" (change)="patch({ yMax: $any($event.target).value })" />
          </div>
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
    @container (min-width: 760px) { .rce__preview { position: sticky; top: 8px; } }
    @media (max-width: 640px) {
      .rce .nd-input { font-size: 16px; min-height: 44px; }
      .rce .nd-seg__item { min-height: 40px; }
      .rce__linesel { flex-basis: 120px; }
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

  readonly unitOptions = computed<PfSelectOption[]>(() => [
    { value: '', label: 'Main result' },
    ...seriesUnits(this.context()).map(u => ({ value: u, label: u })),
  ]);

  readonly preview = computed(() => {
    const ctx = this.context();
    const titles = Object.fromEntries(ctx.params.filter(p => p.title).map(p => [p.name, p.title as string]));
    return buildChartData(this.spec(), this.title() || 'Chart', ctx.ownerId, sampleChartTests(ctx), titles);
  });

  tickLabel(offset: number): string { return offsetTickLabel(offset, this.spec().xLabels); }

  patch(p: Partial<Record<keyof ReportChartSpec, unknown>>) {
    const next = normalizeChartSpec({ ...this.spec(), ...p });
    if (next) this.specChange.emit(next);
  }

  setX(x: 'series' | 'parameters') {
    if (x === this.spec().x) return;
    if (x === 'series') this.patch({ x, lines: [{}], kind: 'line' });
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
  addLine() { this.patch({ lines: [...(this.spec().lines ?? [{}]), { unit: seriesUnits(this.context())[1] ?? null }] }); }
  removeLine(i: number) { this.patch({ lines: (this.spec().lines ?? []).filter((_, k) => k !== i) }); }

  isPicked(name: string): boolean { return (this.spec().parameters ?? []).some(p => p.toLowerCase() === name.toLowerCase()); }
  toggleParam(name: string) {
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
