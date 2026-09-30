import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output } from '@angular/core';
import { plural } from '../../../../shared/utils/plural';
import type { OpdFormListRow, OpdStarter } from '../opd-admin.api';
import { OpdQType, Q_TYPES, Q_TYPE_ORDER, allQuestions, normalizeSchema, typeName } from './form-schema';
import { libraryVersion } from '../opd-admin.util';

/** What the starter gallery picked. */
export type StarterPick = { kind: 'starter'; key: string } | { kind: 'copy'; formId: string } | { kind: 'blank' };

/**
 * The form builder's two galleries, as one themed modal (never a native
 * control): `starters` = "Start a new form" (specialty starters from the
 * server, copy a library form, or blank); `types` = "Browse answer types"
 * (each card shows how the doctor answers). Esc / × / the scrim close.
 */
@Component({
  selector: 'pf-opd-form-gallery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fg-scrim" (click)="closed.emit()"></div>
    <div class="fg nd-card" role="dialog" aria-modal="true" aria-labelledby="fg-title" (keydown.escape)="closed.emit()">
      <header class="fg__h">
        <div class="fg__ht">
          <h2 id="fg-title">{{ kind() === 'starters' ? 'Start a new form' : changing() ? 'Change how “' + changing() + '” is answered' : 'Add a question' }}</h2>
          <p>{{ kind() === 'starters' ? 'Pick a specialty starter — every question can be changed after. Nothing reaches doctors until you publish.' : 'Pick how the doctor answers. Each card says how it looks to the doctor.' }}</p>
        </div>
        <button type="button" class="nd-btn nd-btn--icon fg__x" (click)="closed.emit()" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="fg__b">
        @if (kind() === 'starters') {
          <div class="fg-grid">
            @for (s of starterCards(); track s.key) {
              <button type="button" class="fg-card press" (click)="picked.emit({ kind: 'starter', key: s.key })">
                <span class="fg-card__h"><b>{{ s.name }}</b><small>{{ plural(s.questions.length, 'question') }}</small></span>
                <span class="fg-card__pv">
                  @for (q of s.questions.slice(0, 4); track q.key) { <span class="fg-card__q">{{ q.label }}<small>{{ typeName(q) }}</small></span> }
                  @if (s.questions.length > 4) { <span class="fg-card__more">+ {{ s.questions.length - 4 }} more</span> }
                </span>
                <span class="fg-card__f">Start from {{ s.name }}</span>
              </button>
            }
          </div>
          @if (library().length) {
            <div class="fg-sec">Or copy a form from the library</div>
            <div class="fg-list">
              @for (f of library(); track f.id) {
                <button type="button" class="fg-li press" (click)="picked.emit({ kind: 'copy', formId: f.id })">
                  <span><b>{{ f.name }}</b><small>{{ version(f) }} · {{ plural(f.questionCount, 'question') }}</small></span>
                  <span class="fg-li__a">Copy</span>
                </button>
              }
            </div>
          }
          <div class="fg-list" style="margin-top:8px">
            <button type="button" class="fg-li press" (click)="picked.emit({ kind: 'blank' })"><span><b>Blank form</b><small>Start with no questions</small></span><span class="fg-li__a">Start</span></button>
          </div>
        } @else {
          <div class="fg-grid fg-grid--types">
            @for (t of types; track t) {
              <button type="button" class="fg-type press" [attr.aria-pressed]="current() === t" (click)="type.emit(t)">
                <b>{{ Q_TYPES[t][0] }}</b><small>{{ Q_TYPES[t][1] }}</small><em>e.g. {{ Q_TYPES[t][2] }}</em>
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .fg-scrim { position: absolute; inset: 0; background: rgba(15, 23, 42, .45); }
    .fg { position: relative; width: min(980px, 100%); max-height: min(86dvh, 820px); display: flex; flex-direction: column; overflow: hidden; }
    .fg__h { display: flex; gap: 12px; align-items: flex-start; padding: 18px 20px 12px; border-bottom: 1px solid var(--nd-line); }
    .fg__ht { flex: 1 1 auto; }
    .fg__ht h2 { margin: 0; font-size: 17px; font-weight: 600; color: var(--text-primary); }
    .fg__ht p { margin: 4px 0 0; font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
    .fg__x { flex: none; }
    .fg__b { overflow-y: auto; padding: 16px 20px 20px; }
    .fg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .fg-grid--types { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
    .fg-card, .fg-type, .fg-li { text-align: left; font: inherit; cursor: pointer; border-radius: 12px; border: 1px solid var(--nd-line); background: var(--nd-card-bg); color: var(--text-primary); }
    .fg-card:hover, .fg-type:hover, .fg-li:hover { border-color: var(--nd-sel-border); }
    .fg-card:focus-visible, .fg-type:focus-visible, .fg-li:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .fg-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
    .fg-card__h { display: flex; flex-direction: column; gap: 2px; }
    .fg-card__h b { font-size: 14.5px; }
    .fg-card__h small, .fg-li small { font-size: 12px; color: var(--text-tertiary); }
    .fg-card__pv { display: flex; flex-direction: column; gap: 6px; }
    .fg-card__q { display: flex; flex-direction: column; font-size: 12.5px; color: var(--text-secondary); }
    .fg-card__q small { font-size: 11.5px; color: var(--text-tertiary); }
    .fg-card__more { font-size: 12px; color: var(--text-tertiary); }
    .fg-card__f { margin-top: auto; font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); }
    .fg-sec { margin: 18px 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
    .fg-list { display: flex; flex-direction: column; gap: 6px; }
    .fg-li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 10px 12px; }
    .fg-li span:first-child { display: flex; flex-direction: column; gap: 2px; }
    .fg-li__a { font-size: 12.5px; font-weight: 600; color: var(--violet-text, #6d28d9); }
    .fg-type { display: flex; flex-direction: column; gap: 4px; padding: 14px; min-height: 96px; }
    .fg-type b { font-size: 14px; }
    .fg-type small { font-size: 12.5px; color: var(--text-secondary); }
    .fg-type em { font-style: normal; font-size: 12px; color: var(--text-tertiary); }
    .fg-type[aria-pressed='true'] { border-color: var(--nd-sel-border); background: var(--nd-sel-bg); }
    @media (max-width: 640px) {
      :host { align-items: flex-end; padding: 0; }
      .fg { width: 100%; max-height: 88dvh; border-radius: 18px 18px 0 0; margin-bottom: calc(var(--nd-nav-h, 64px) + env(safe-area-inset-bottom, 0px)); }
    }
  `],
})
export class OpdFormGalleryComponent implements AfterViewInit {
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly kind = input<'starters' | 'types'>('starters');
  readonly starters = input<OpdStarter[]>([]);
  readonly library = input<OpdFormListRow[]>([]);
  /** types: the selected question's current type ('lr' for left & right) and its wording. */
  readonly current = input<OpdQType | 'lr' | null>(null);
  readonly changing = input<string | null>(null);
  readonly picked = output<StarterPick>();
  readonly type = output<OpdQType | 'lr'>();
  readonly closed = output<void>();

  protected readonly plural = plural;
  protected readonly typeName = typeName;
  protected readonly Q_TYPES = Q_TYPES;
  readonly types = Q_TYPE_ORDER;
  readonly starterCards = computed(() => this.starters().map((s) => ({ ...s, questions: allQuestions(normalizeSchema(s.schema)) })));
  version(f: OpdFormListRow): string { return libraryVersion(f); }

  ngAfterViewInit(): void {
    const first = (this.el.nativeElement as HTMLElement).querySelector<HTMLElement>('.fg-type[aria-pressed="true"], .fg-card, .fg-type, .fg__x');
    first?.focus({ preventScroll: true });
  }
}
