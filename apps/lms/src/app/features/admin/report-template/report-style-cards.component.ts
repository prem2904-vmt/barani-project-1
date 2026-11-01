import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { ReportTemplate } from '../../../shared/models/report.model';
import {
  PALETTES, allChecksPass, checkColors, derivePaletteFromAccent, detectPalette, greyOf, normalizeHex, templateColors,
  type PaletteColors, type PaletteId,
} from '../../../shared/utils/report-palettes';
import { PRESET_INFO, detectPreset, type PresetId } from '../../../shared/utils/report-presets';
import { readReportStyle } from '../../../shared/utils/report-style';

/**
 * Report designer -> Results table: "Style presets" and "Colour palette".
 *
 * Presentational: it reads the template, and says what the editor should do
 * (apply a preset, a palette or custom colours, flip the print check, undo).
 * The editor owns the template and its undo history, so one click is one undo
 * step. The writing logic is pure (report-presets.ts, report-palettes.ts).
 */
@Component({
  selector: 'pf-report-style-cards',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-sty-block" id="pf-presets">
      <h4 class="pf-sty-h">Style presets</h4>
      <p class="pf-sty-s">One click sets the patient block, text fitting, row spacing, page numbers, type and colours together. Undo puts everything back, and you can still change any single setting afterwards.</p>
      <div class="pf-sty-presets" role="radiogroup" aria-label="Style preset">
        @for (p of presets; track p.id) {
          <button type="button" class="pf-sty-card press" role="radio" [attr.aria-checked]="currentPreset() === p.id"
                  (click)="preset.emit(p.id)">
            <span class="pf-sty-card__top">
              <span class="pf-sty-card__name">{{ p.label }}</span>
              @if (currentPreset() === p.id) {
                <span class="pf-sty-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Current
                </span>
              }
            </span>
            <span class="pf-sty-card__desc">{{ p.desc }}</span>
            <span class="pf-sty-card__k">What this changes</span>
            <ul class="pf-sty-card__list">
              @for (c of p.changes; track c) { <li>{{ c }}</li> }
            </ul>
          </button>
        }
      </div>
      @if (currentPreset() === 'custom') {
        <p class="pf-sty-s pf-sty-after">Your settings are a custom mix — not exactly one of these presets.</p>
      }
      @if (applied(); as a) {
        <div class="pf-sty-done" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          <span class="pf-sty-done__t">{{ appliedLabel() }} applied. Your logo, field names, signatures and sequencing are unchanged.</span>
          <button type="button" class="pf-sty-undo press" (click)="undo.emit()">Undo</button>
        </div>
      }
    </div>

    <div class="pf-sty-block" id="pf-palette">
      <h4 class="pf-sty-h">Colour palette</h4>
      <p class="pf-sty-s">Sets the lab name, accent bar, table header, hairlines and High / Low value colours together. Every palette stays readable on a black-and-white printer.</p>
      <div class="pf-sty-pals" role="radiogroup" aria-label="Colour palette">
        @for (p of palettes; track p.id) {
          <button type="button" class="pf-sty-pal press" role="radio" [attr.aria-checked]="currentPalette() === p.id"
                  [attr.aria-label]="p.label + ' — ' + p.note" (click)="palette.emit(p.id)">
            <span class="pf-sty-chips" aria-hidden="true">
              <i [style.background]="p.colors.primaryColor"></i>
              <i [style.background]="p.colors.accentColor"></i>
              <i [style.background]="p.colors.tableHeaderBg" class="pf-sty-chip--line"></i>
              <i [style.background]="p.colors.abnormalColor"></i>
              <i [style.background]="p.colors.abnormalLowColor"></i>
            </span>
            <span class="pf-sty-pal__name">{{ p.label }}</span>
            <span class="pf-sty-pal__note">{{ p.note }}</span>
          </button>
        }
      </div>
      @if (currentPalette() === 'custom') {
        <p class="pf-sty-s pf-sty-after">Your colours are set by hand (not one of these palettes).</p>
      }

      <div class="pf-sty-custom">
        <div class="pf-sty-custom__pick">
          <label class="pf-sty-lab" for="pf-sty-accent">Your own accent</label>
          <label class="pf-sty-colorfield">
            <input id="pf-sty-accent" type="color" [value]="draftAccent()" (input)="onAccent($any($event.target).value)" />
            <span class="pf-sty-colorfield__hex">{{ draftAccent() }}</span>
          </label>
        </div>
        <div class="pf-sty-custom__out">
          <span class="pf-sty-chips pf-sty-chips--lg" aria-hidden="true">
            <i [style.background]="draft().primaryColor"></i>
            <i [style.background]="draft().accentColor"></i>
            <i [style.background]="draft().tableHeaderBg" class="pf-sty-chip--line"></i>
            <i [style.background]="draft().abnormalColor"></i>
            <i [style.background]="draft().abnormalLowColor"></i>
          </span>
          <span class="pf-sty-s pf-sty-custom__t">Lab name, header row and hairlines are worked out from this one colour.</span>
        </div>
        <button type="button" class="pf-sty-use press" [disabled]="!draftDiffers()" (click)="custom.emit(draft())">Use these colours</button>
      </div>
      @if (printSafe() && draftDiffers()) {
        <div class="pf-sty-checks-k">Check for these colours</div>
        <ng-container *ngTemplateOutlet="list; context: { $implicit: draftChecks() }"></ng-container>
      }

      <div class="pf-sqr pf-sty-printrow">
        <div class="pf-sqr__row">
          <span class="pf-sqr__txt">
            <span class="pf-sqr__label">Check colours for print</span>
            <span class="pf-sqr__desc">Warns when text is hard to read or High and Low look alike in black and white. It never changes the report.</span>
          </span>
          <button type="button" class="pf-toggle pf-rt-sw pf-sqr__sw" role="switch" [attr.aria-checked]="printSafe()"
                  aria-label="Check colours for print" (click)="printSafeChange.emit(!printSafe())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
      </div>
      @if (printSafe()) {
        <div class="pf-sty-checks-k">Your report today</div>
        <ng-container *ngTemplateOutlet="list; context: { $implicit: checks() }"></ng-container>
        <div class="pf-sty-grey" aria-hidden="true">
          <span class="pf-sty-grey__k">High and Low in black and white</span>
          <span class="pf-sty-grey__pair">
            <i [style.background]="greyOf(cur().abnormalColor)"></i>
            <i [style.background]="greyOf(cur().abnormalLowColor)"></i>
          </span>
        </div>
      }
    </div>

    <ng-template #list let-items>
      <ul class="pf-sty-checks">
        @for (c of items; track c.id) {
          <li class="pf-sty-check" [class.pf-sty-check--bad]="!c.ok">
            @if (c.ok) {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            } @else {
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            }
            <span class="pf-sty-check__txt"><b>{{ c.label }}</b><span class="pf-sty-check__d"> {{ c.ok ? '' : 'Needs attention. ' }}{{ c.detail }}</span></span>
          </li>
        }
      </ul>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: [`
    :host { display: contents; }
    .pf-sty-block { margin: 0; padding: 16px 0; border-top: 1px solid var(--glass-border, rgba(148,163,184,0.14)); }
    .pf-sty-block:first-child { border-top: 0; padding-top: 2px; }
    .pf-sty-h { margin: 0 0 2px; font-size: 13px; font-weight: 600; color: var(--text-primary, #e2e8f0); }
    .pf-sty-s { margin: 0 0 12px; font-size: 12px; line-height: 1.45; color: var(--text-tertiary, #94a3b8); }
    .pf-sty-after { margin: 10px 0 0; }
    .pf-sty-presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 760px) { .pf-sty-presets { grid-template-columns: 1fr; } }
    .pf-sty-card { display: flex; flex-direction: column; align-items: stretch; gap: 5px; text-align: left; min-height: 44px;
      padding: 12px; border-radius: 12px; cursor: pointer; font: inherit; background: transparent;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); color: var(--text-primary, #e2e8f0); }
    .pf-sty-card[aria-checked='true'], .pf-sty-pal[aria-checked='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-sty-card:focus-visible, .pf-sty-pal:focus-visible, .pf-sty-use:focus-visible, .pf-sty-undo:focus-visible { outline: 2px solid var(--pf-sel-border); outline-offset: 2px; }
    .pf-sty-card__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .pf-sty-card__name { font-size: 14px; font-weight: 700; }
    .pf-sty-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 2px 8px;
      border-radius: 999px; color: var(--text-secondary); background: var(--surface-2); border: 1px solid var(--border-muted); }
    .pf-sty-card__desc { font-size: 12px; line-height: 1.4; color: var(--text-secondary, #94a3b8); }
    .pf-sty-card__k { margin-top: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary, #94a3b8); }
    .pf-sty-card__list { margin: 0; padding-left: 16px; list-style: disc; display: flex; flex-direction: column; gap: 2px; font-size: 12px; line-height: 1.4; color: var(--text-secondary, #94a3b8); }
    .pf-sty-done { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 8px 10px; border-radius: 10px;
      color: var(--text-secondary); background: var(--surface-2); border: 1px solid var(--border-muted); }
    .pf-sty-done__t { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.4; }
    .pf-sty-undo, .pf-sty-use { min-height: 36px; padding: 0 14px; border-radius: 9px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
      color: var(--text-primary); background: transparent; border: 1px solid var(--glass-border, rgba(148,163,184,0.35)); }
    .pf-sty-use:disabled { opacity: .45; cursor: not-allowed; }
    .pf-sty-pals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 760px) { .pf-sty-pals { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .pf-sty-pal { display: flex; flex-direction: column; align-items: stretch; gap: 5px; text-align: left; min-height: 44px; padding: 10px;
      border-radius: 12px; cursor: pointer; font: inherit; background: transparent;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); color: var(--text-primary, #e2e8f0); }
    .pf-sty-pal__name { font-size: 13px; font-weight: 600; }
    .pf-sty-pal__note { font-size: 11.5px; line-height: 1.35; color: var(--text-secondary, #94a3b8); }
    .pf-sty-chips { display: flex; gap: 0; border-radius: 6px; overflow: hidden; height: 20px; border: 1px solid rgba(0,0,0,0.15); background: #fff; }
    .pf-sty-chips i { flex: 1; display: block; }
    .pf-sty-chips--lg { height: 26px; width: 160px; flex: none; }
    .pf-sty-chip--line { border-left: 1px solid rgba(0,0,0,0.12); border-right: 1px solid rgba(0,0,0,0.12); }
    .pf-sty-custom { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-top: 16px; padding-top: 14px;
      border-top: 1px dashed var(--glass-border, rgba(148,163,184,0.2)); }
    .pf-sty-lab { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500; color: var(--text-tertiary, #94a3b8); }
    .pf-sty-colorfield { display: flex; align-items: center; height: 38px; border-radius: 10px; overflow: hidden;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.25)); }
    .pf-sty-colorfield input[type="color"] { width: 42px; height: 46px; margin: -4px 0 -4px -4px; border: 0; padding: 0; background: transparent; cursor: pointer; }
    .pf-sty-colorfield__hex { padding: 0 10px; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--text-secondary); }
    .pf-sty-custom__out { display: flex; align-items: center; gap: 10px; flex: 1 1 260px; min-width: 0; }
    .pf-sty-custom__t { margin: 0; }
    .pf-sty-checks-k { margin: 14px 0 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary, #94a3b8); }
    .pf-sty-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-sty-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; line-height: 1.4; color: var(--text-secondary, #94a3b8); }
    .pf-sty-check svg { flex: none; margin-top: 2px; }
    .pf-sty-check b { color: var(--text-primary, #e2e8f0); font-weight: 600; }
    .pf-sty-check--bad b { text-decoration: underline; text-decoration-style: wavy; text-underline-offset: 3px; }
    .pf-sty-check--bad .pf-sty-check__d { color: var(--text-primary, #e2e8f0); }
    .pf-sty-printrow { margin-top: 14px; }
    .pf-sqr { display: flex; flex-direction: column; gap: 2px; }
    .pf-sqr__row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 8px 0; }
    .pf-sqr__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-sqr__label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-sqr__desc { font-size: 12px; line-height: 1.4; color: var(--text-muted); }
    .pf-sqr__sw { flex: none; min-width: 44px; min-height: 44px; }
    .pf-sty-grey { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 12px; color: var(--text-tertiary, #94a3b8); }
    .pf-sty-grey__pair { display: inline-flex; border-radius: 6px; overflow: hidden; border: 1px solid rgba(0,0,0,0.2); }
    .pf-sty-grey__pair i { display: block; width: 34px; height: 18px; }
  `],
})
export class ReportStyleCardsComponent {
  readonly tpl = input.required<ReportTemplate>();
  /** The preset just applied (the editor clears it when the settings move off it). */
  readonly applied = input<PresetId | null>(null);

  readonly preset = output<PresetId>();
  readonly palette = output<PaletteId>();
  readonly custom = output<PaletteColors>();
  readonly printSafeChange = output<boolean>();
  readonly undo = output<void>();

  readonly presets = PRESET_INFO;
  readonly palettes = PALETTES;
  readonly greyOf = greyOf;

  readonly currentPreset = computed(() => detectPreset(this.tpl()));
  readonly currentPalette = computed(() => detectPalette(this.tpl()));
  readonly appliedLabel = computed(() => PRESET_INFO.find(p => p.id === this.applied())?.label ?? '');
  readonly printSafe = computed(() => readReportStyle(this.tpl()).colors.printSafe);

  readonly cur = computed(() => templateColors(this.tpl()));
  private readonly flagsColoured = computed(() => this.tpl().flagStyle === 'bold_color');
  readonly checks = computed(() => checkColors({ ...this.cur(), bodyTextColor: this.tpl().bodyTextColor }, this.flagsColoured()));
  readonly allPass = computed(() => allChecksPass(this.checks()));

  /** The accent being tried (null = the template's own). */
  private readonly accent = signal<string | null>(null);
  readonly draftAccent = computed(() => this.accent() ?? normalizeHex(this.cur().accentColor) ?? '#0066cc');
  readonly draft = computed(() => derivePaletteFromAccent(this.draftAccent()));
  readonly draftChecks = computed(() => checkColors({ ...this.draft(), bodyTextColor: this.tpl().bodyTextColor }, this.flagsColoured()));
  readonly draftDiffers = computed(() => {
    const d = this.draft(), c = this.cur();
    return (Object.keys(d) as Array<keyof PaletteColors>).some(k => d[k].toLowerCase() !== c[k].toLowerCase());
  });
  onAccent(v: string) { this.accent.set(normalizeHex(v)); }
}
