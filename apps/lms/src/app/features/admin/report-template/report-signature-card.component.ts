import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ReportTemplate } from '../../../shared/models/report.model';
import { DEFAULT_REPORT_STYLE, readReportStyle, writeReportStyle, type ReportSignatureStyle } from '../../../shared/utils/report-style';
import { samplePlan, signatureCost, signatureReadout } from '../../../shared/utils/report-signature-space';

/**
 * Report designer -> Footer: the Signatures card (report layout plan 3.10).
 *
 * Decides where the sign-off prints, what it shows and how much room it keeps,
 * and says what that costs ("2 signatories · 1 row · 28 mm · at the end of each
 * department") from the same plan the renderer uses. WHO signs is not here: it
 * stays each department's own present signatories.
 *
 * Presentational: it reads the template and emits a metadata patch; the editor
 * owns the template, its undo history and the live preview.
 */
@Component({
  selector: 'pf-report-signature-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-sgc" aria-label="Signatures">
      <h4 class="pf-sgc__h">Signatures</h4>
      <p class="pf-sgc__s">Who signs does not change: each department's own signatories, only the ones present. This decides where and how they print.</p>

      <span class="pf-sgc__k" id="pf-sgc-where">Where they print</span>
      <div class="pf-sgc__tiles" role="radiogroup" aria-labelledby="pf-sgc-where">
        @for (p of placements; track p.value) {
          <button type="button" class="pf-sgc__tile press" role="radio" [attr.aria-checked]="style().placement === p.value" (click)="set({ placement: p.value })">
            <span class="pf-sgc__pic" [class]="'pf-sgc__pic pf-sgc__pic--' + p.value" aria-hidden="true">
              <i></i><i></i><i></i><b></b><b></b>
            </span>
            <span class="pf-sgc__tn">{{ p.label }}</span>
            <span class="pf-sgc__td">{{ p.hint }}</span>
          </button>
        }
      </div>

      <span class="pf-sgc__k" id="pf-sgc-show">What they show</span>
      <div class="pf-seg pf-sgc__seg" role="radiogroup" aria-labelledby="pf-sgc-show">
        @for (o of shows; track o.value) {
          <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="style().show === o.value" (click)="set({ show: o.value })">{{ o.label }}</button>
        }
      </div>
      @if (style().reserveMm && style().show === 'image') {
        <p class="pf-sgc__note">Pre-printed paper keeps its own signature area, so names print without an image.</p>
      }

      @if (style().show === 'image' && !style().reserveMm) {
        <div class="pf-sgc__row">
          <label class="pf-sgc__k" for="pf-sgc-imgh">Signature image height</label>
          <div class="pf-sgc__slider">
            <input id="pf-sgc-imgh" type="range" min="16" max="40" step="2" [value]="style().imageH" (input)="set({ imageH: +$any($event.target).value })" aria-label="Signature image height" />
            <span class="pf-sgc__val pf-num">{{ style().imageH }} pt</span>
          </div>
        </div>
      }

      @if (style().show === 'verified-line') {
        <label class="pf-sgc__field">
          <span class="pf-sgc__k">Wording</span>
          <input class="pf-input" type="text" maxlength="160" [value]="style().verifiedText" (change)="setText($any($event.target).value)" aria-label="Verified line wording" />
          <span class="pf-sgc__hint">Use {{ '{' }}name{{ '}' }}, {{ '{' }}title{{ '}' }}, {{ '{' }}reg{{ '}' }} and {{ '{' }}datetime{{ '}' }}. The registration number follows the name unless you place it.</span>
        </label>
      }

      @if (style().show !== 'verified-line') {
        <span class="pf-sgc__k" id="pf-sgc-row">Side by side, at most</span>
        <div class="pf-seg pf-sgc__seg" role="radiogroup" aria-labelledby="pf-sgc-row">
          @for (n of perRow; track n) {
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="style().maxPerRow === n" (click)="set({ maxPerRow: n })">{{ n }}</button>
          }
        </div>
      }

      @if (template().letterpadMode) {
        <label class="pf-sgc__field">
          <span class="pf-sgc__k">Room for your printed signature area</span>
          <span class="pf-sgc__mm">
            <input class="pf-input pf-num" type="number" min="5" max="120" step="1" placeholder="none"
                   [value]="style().reserveMm ?? ''" (change)="setReserve($any($event.target).value)" aria-label="Reserve for pre-printed stationery, mm" />
            <span class="pf-sgc__unit">mm</span>
          </span>
          <span class="pf-sgc__hint">Keeps this much blank at the foot and prints names under it. Leave empty to print the whole sign-off.</span>
        </label>
      }

      <div class="pf-sgc__out" role="status" aria-live="polite">
        <span class="pf-sgc__out-k">What this takes</span>
        <span class="pf-sgc__out-t pf-num">{{ readout() }}</span>
        <span class="pf-sgc__out-s">{{ cost() }}</span>
        @if (plan().reserveTooSmall) {
          <span class="pf-sgc__warn">The names need more than the room you reserved. The block grows to fit them.</span>
        }
        <span class="pf-sgc__k pf-sgc__try" id="pf-sgc-try">Try it with this many signatories</span>
        <div class="pf-seg pf-sgc__seg" role="radiogroup" aria-labelledby="pf-sgc-try">
          @for (n of samples; track n) {
            <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="sample() === n" [attr.aria-label]="'Try with ' + n + (n === 1 ? ' signatory' : ' signatories')" (click)="sampleChange.emit(n)">{{ n }}</button>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-sgc { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--pf-line); }
    .pf-sgc__h { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-sgc__s { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary); }
    .pf-sgc__k { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pf-sgc__tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .pf-sgc__tile { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 8px; min-height: 44px; text-align: left; font: inherit; cursor: pointer;
      border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-card-bg); color: var(--text-primary); }
    .pf-sgc__tile[aria-checked='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-sgc__tile:focus-visible { outline: 2px solid var(--pf-sel-border); outline-offset: 2px; }
    .pf-sgc__tn { font-size: 12.5px; font-weight: 600; }
    .pf-sgc__td { font-size: 11.5px; line-height: 1.35; color: var(--text-secondary); }
    .pf-sgc__pic { position: relative; display: block; width: 100%; aspect-ratio: 3 / 2; border-radius: 4px; background: #fff; border: 1px solid #cbd5e1; overflow: hidden; }
    .pf-sgc__pic i { position: absolute; left: 12%; right: 12%; height: 2px; background: #e2e8f0; }
    .pf-sgc__pic i:nth-child(1) { top: 16%; } .pf-sgc__pic i:nth-child(2) { top: 28%; } .pf-sgc__pic i:nth-child(3) { top: 40%; right: 40%; }
    .pf-sgc__pic b { position: absolute; height: 3px; width: 26%; border-radius: 2px; background: #475569; }
    .pf-sgc__pic b:nth-of-type(1) { left: 12%; } .pf-sgc__pic b:nth-of-type(2) { right: 12%; }
    .pf-sgc__pic--department b { top: 54%; }
    .pf-sgc__pic--end i:nth-child(3) { right: 12%; }
    .pf-sgc__pic--end b { bottom: 14%; }
    .pf-sgc__pic--every-page::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 28%; border-top: 1px dashed #94a3b8; background: #f1f5f9; }
    .pf-sgc__pic--every-page b { bottom: 10%; z-index: 1; }
    .pf-sgc__seg { flex-wrap: wrap; align-self: flex-start; }
    .pf-sgc__note, .pf-sgc__hint { margin: 0; font-size: 12px; line-height: 1.4; color: var(--text-tertiary); }
    .pf-sgc__row, .pf-sgc__field { display: flex; flex-direction: column; gap: 6px; }
    .pf-sgc__slider { display: flex; align-items: center; gap: 10px; }
    .pf-sgc__slider input[type=range] { flex: 1 1 auto; min-width: 0; accent-color: var(--pf-switch-on); height: 28px; }
    .pf-sgc__val { min-width: 48px; text-align: right; font-size: 13px; color: var(--text-primary); }
    .pf-sgc__mm { display: inline-flex; align-items: center; gap: 8px; }
    .pf-sgc__mm .pf-input { width: 96px; }
    .pf-sgc__unit { font-size: 12px; color: var(--text-tertiary); }
    .pf-sgc__out { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: var(--pf-radius-sm); border: 1px solid var(--pf-line); background: var(--pf-card-bg); }
    .pf-sgc__out-k { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-sgc__out-t { font-size: 13.5px; font-weight: 600; line-height: 1.35; color: var(--text-primary); }
    .pf-sgc__out-s { font-size: 12px; line-height: 1.4; color: var(--text-secondary); }
    .pf-sgc__warn { font-size: 12px; line-height: 1.4; color: var(--red-text, #b91c1c); }
    .pf-sgc__try { margin-top: 8px; }
    @media (max-width: 520px) { .pf-sgc__tiles { grid-template-columns: 1fr; } }
    @media (pointer: coarse) { .pf-seg__item { min-height: 40px; } }
  `],
})
export class ReportSignatureCardComponent {
  readonly template = input.required<ReportTemplate>();
  /** How many sample signatories the readout and the preview try. */
  readonly sample = input(2);
  readonly patch = output<Partial<ReportTemplate>>();
  readonly sampleChange = output<number>();

  readonly style = computed<ReportSignatureStyle>(() => readReportStyle(this.template()).signatures);
  readonly plan = computed(() => samplePlan(this.style(), this.sample()));
  readonly readout = computed(() => signatureReadout(this.plan()));
  readonly cost = computed(() => signatureCost(this.plan()));

  readonly placements: ReadonlyArray<{ value: ReportSignatureStyle['placement']; label: string; hint: string }> = [
    { value: 'department', label: 'Each department', hint: 'At the end of its own results (today).' },
    { value: 'end', label: 'Once, at the end', hint: 'After End of Report. Fewer pages.' },
    { value: 'every-page', label: 'Every page', hint: 'At the foot of each page.' },
  ];
  readonly shows: ReadonlyArray<{ value: ReportSignatureStyle['show']; label: string }> = [
    { value: 'image', label: 'Signature image' },
    { value: 'name-only', label: 'Name only' },
    { value: 'verified-line', label: 'Verified line' },
  ];
  readonly perRow = [2, 3, 4];
  readonly samples = [1, 2, 3, 4, 7];

  set(p: Partial<ReportSignatureStyle>): void {
    this.patch.emit({ metadata: writeReportStyle(this.template(), { signatures: p }) });
  }
  setText(v: string): void {
    this.set({ verifiedText: v.trim() ? v : DEFAULT_REPORT_STYLE.signatures.verifiedText });
  }
  setReserve(v: string): void {
    const n = parseFloat(v);
    this.set({ reserveMm: isFinite(n) && n >= 5 ? Math.min(120, Math.round(n)) : null });
  }
}
