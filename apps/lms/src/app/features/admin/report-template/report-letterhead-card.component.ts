import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ReportTemplate } from '../../../shared/models/report.model';
import {
  DEFAULT_LETTERPAD_FOOTER_MM, DEFAULT_LETTERPAD_HEADER_MM, hasLetterheadImage, hasStationeryScan, letterheadPresetOf,
  type LetterheadContinuation, type LetterheadPresetId,
} from '../../../shared/utils/report-letterhead';
import { readReportStyle } from '../../../shared/utils/report-style';

export type LetterheadFileKind = 'scan' | 'image';

/**
 * Report designer -> Letterhead: "Letterhead type" - Digital / Pre-printed paper /
 * Image letterhead, the blank top and bottom of the paper (with "Measure from
 * this image") and what later pages carry.
 *
 * Presentational: it reads the template and says what the editor should do
 * (apply a preset, pick a file, measure, change a number). The editor owns the
 * template, the upload and its undo history, so one click is one undo step; the
 * writing logic is pure (report-letterhead.ts).
 */
@Component({
  selector: 'pf-report-letterhead-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h4 class="pf-lhc-h">Letterhead type</h4>
    <div class="pf-lhc-tiles" role="radiogroup" aria-label="Letterhead type">
      @for (p of presets; track p.id) {
        <button type="button" class="pf-lhc-tile press" role="radio" [attr.aria-checked]="preset() === p.id" (click)="presetChange.emit(p.id)">
          <span class="pf-lhc-thumb" [class]="'pf-lhc-thumb pf-lhc-thumb--' + p.id" aria-hidden="true"><i></i><b></b><b></b><em></em></span>
          <span class="pf-lhc-name">{{ p.label }}</span>
          <span class="pf-lhc-desc">{{ p.desc }}</span>
        </button>
      }
    </div>

    @switch (preset()) {
      @case ('digital') {
        <div class="pf-lhc-sub">
          <span class="pf-lhc-k">Pages after the first</span>
          <div class="pf-seg" role="radiogroup" aria-label="Pages after the first">
            @for (c of conts; track c.id) {
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="continuation() === c.id" (click)="continuationChange.emit(c.id)">{{ c.label }}</button>
            }
          </div>
          <p class="pf-lhc-s">{{ contHint() }}</p>
        </div>
      }
      @case ('preprinted') {
        <div class="pf-lhc-sub">
          <label class="pf-btn pf-btn--secondary pf-lhc-file" [class.pf-lhc-file--off]="busy()">
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden [disabled]="busy()" (change)="onFile('scan', $event)" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>
            {{ busy() ? 'Reading your stationery…' : hasScan() ? 'Replace the stationery scan' : 'Upload a scan or photo of your stationery' }}
          </label>
          <p class="pf-lhc-s">{{ hasScan()
            ? 'The scan shows on screen, in downloads and in shared reports. It is left off when you print on your letterhead paper.'
            : 'Until you add a scan, shared and downloaded reports keep the letterhead we draw. We measure the scan for you.' }}</p>
          <div class="pf-lhc-mm">
            <label class="pf-field"><span class="pf-field__lbl">Blank at the top (mm)</span>
              <input class="pf-input pf-num" type="number" min="0" max="120" step="0.5" [value]="headerMm()" (change)="mm.emit({ headerMm: +$any($event.target).value })" /></label>
            <label class="pf-field"><span class="pf-field__lbl">Blank at the bottom (mm)</span>
              <input class="pf-input pf-num" type="number" min="0" max="120" step="0.5" [value]="footerMm()" (change)="mm.emit({ footerMm: +$any($event.target).value })" /></label>
          </div>
          @if (hasScan()) {
            <button type="button" class="pf-btn pf-btn--tertiary pf-lhc-measure" [disabled]="busy()" (click)="measure.emit()">Measure from this image</button>
          }
          <p class="pf-lhc-s">Printing asks whether to use your letterhead paper. Pages after the first use the same stationery.</p>
        </div>
      }
      @case ('image') {
        <div class="pf-lhc-sub">
          <label class="pf-btn pf-btn--secondary pf-lhc-file" [class.pf-lhc-file--off]="busy()">
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden [disabled]="busy()" (change)="onFile('image', $event)" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
            {{ busy() ? 'Uploading…' : hasImage() ? 'Replace the letterhead image' : 'Choose your letterhead image' }}
          </label>
          <p class="pf-lhc-s">{{ hasImage()
            ? 'The picture runs across the top of every page, and the patient details start under it. The lab name and contact lines we draw are switched off.'
            : 'A wide PNG, JPG or WebP made for the top of the page. Until you add one, the letterhead we draw stays.' }}</p>
        </div>
      }
    }
    @if (note(); as n) { <p class="pf-lhc-note" role="status">{{ n }}</p> }
    @if (error(); as e) { <p class="pf-lhc-err" role="alert">{{ e }}</p> }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .pf-lhc-h { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-lhc-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    @media (max-width: 420px) { .pf-lhc-tiles { grid-template-columns: 1fr; } }
    .pf-lhc-tile { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px; text-align: left; min-height: 44px;
      border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-card-bg); font: inherit; color: var(--text-secondary); cursor: pointer; }
    .pf-lhc-tile[aria-checked='true'] { border-color: var(--pf-slate-600, #475569); box-shadow: inset 0 0 0 1px var(--pf-slate-600, #475569); color: var(--text-primary); }
    .pf-lhc-name { font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
    .pf-lhc-desc { font-size: 11.5px; line-height: 1.35; color: var(--text-secondary); }
    .pf-lhc-thumb { position: relative; display: block; width: 100%; aspect-ratio: 3 / 4; max-height: 74px; border-radius: 4px; background: #fff; border: 1px solid #e2e8f0; overflow: hidden; }
    .pf-lhc-thumb i { position: absolute; left: 10%; top: 8%; width: 18%; aspect-ratio: 1; border-radius: 50%; background: #94a3b8; }
    .pf-lhc-thumb b { position: absolute; left: 34%; top: 10%; width: 50%; height: 6%; border-radius: 2px; background: #64748b; }
    .pf-lhc-thumb b + b { top: 22%; width: 34%; background: #cbd5e1; }
    .pf-lhc-thumb em { position: absolute; left: 10%; right: 10%; top: 40%; height: 3%; background: #cbd5e1; }
    .pf-lhc-thumb--preprinted { background: #f4efe3; border-style: dashed; }
    .pf-lhc-thumb--preprinted em { top: auto; bottom: 8%; height: 7%; background: #cbd5e1; }
    .pf-lhc-thumb--image i, .pf-lhc-thumb--image b { display: none; }
    .pf-lhc-thumb--image em { left: 0; right: 0; top: 0; height: 28%; background: linear-gradient(90deg, #64748b, #94a3b8); }
    .pf-lhc-sub { display: flex; flex-direction: column; gap: 8px; }
    .pf-lhc-k { font-size: 12px; font-weight: 600; color: var(--text-primary); }
    .pf-lhc-s { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
    .pf-lhc-file { cursor: pointer; width: 100%; }
    .pf-lhc-file--off { opacity: .6; cursor: not-allowed; }
    .pf-lhc-mm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .pf-lhc-measure { align-self: flex-start; }
    .pf-lhc-note { margin: 0; padding: 8px 10px; border-radius: var(--pf-radius-sm); font-size: 12.5px; line-height: 1.4; background: var(--pf-surface-2, rgba(100,116,139,.12)); color: var(--text-primary); }
    .pf-lhc-err { margin: 0; padding: 8px 10px; border-radius: var(--pf-radius-sm); font-size: 12.5px; line-height: 1.4; background: var(--pf-danger-soft, rgba(220,38,38,.12)); color: var(--pf-danger, #b91c1c); }
  `],
})
export class ReportLetterheadCardComponent {
  readonly tpl = input.required<ReportTemplate>();
  readonly busy = input(false);
  readonly note = input<string | null>(null);
  readonly error = input<string | null>(null);

  readonly presetChange = output<LetterheadPresetId>();
  readonly continuationChange = output<LetterheadContinuation>();
  readonly pick = output<{ kind: LetterheadFileKind; file: File }>();
  readonly measure = output<void>();
  readonly mm = output<{ headerMm?: number; footerMm?: number }>();

  protected readonly presets: ReadonlyArray<{ id: LetterheadPresetId; label: string; desc: string }> = [
    { id: 'digital', label: 'Digital', desc: 'We draw the letterhead from your lab details.' },
    { id: 'preprinted', label: 'Pre-printed paper', desc: 'Your own stationery. Print leaves the top and bottom blank.' },
    { id: 'image', label: 'Image letterhead', desc: 'One designed picture across the top of every page.' },
  ];
  protected readonly conts: ReadonlyArray<{ id: LetterheadContinuation; label: string }> = [
    { id: 'none', label: 'Nothing' }, { id: 'slim', label: 'Slim' }, { id: 'full', label: 'Full letterhead' },
  ];

  protected readonly preset = computed(() => letterheadPresetOf(this.tpl()));
  protected readonly continuation = computed(() => readReportStyle(this.tpl()).letterhead.continuation);
  protected readonly hasScan = computed(() => hasStationeryScan(this.tpl()));
  protected readonly hasImage = computed(() => hasLetterheadImage(this.tpl()));
  protected readonly headerMm = computed(() => this.tpl().letterpadHeaderMm ?? DEFAULT_LETTERPAD_HEADER_MM);
  protected readonly footerMm = computed(() => this.tpl().letterpadFooterMm ?? DEFAULT_LETTERPAD_FOOTER_MM);
  protected readonly contHint = computed(() => ({
    none: 'Later pages start with the page number and your patient strip, as they do today.',
    slim: 'Later pages start with your lab name and a thin line.',
    full: 'Later pages repeat your whole letterhead.',
  }[this.continuation()]));

  protected onFile(kind: LetterheadFileKind, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.pick.emit({ kind, file });
  }
}
