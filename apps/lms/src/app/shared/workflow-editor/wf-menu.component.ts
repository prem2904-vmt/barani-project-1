import {
  ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, OnDestroy, OnInit, afterNextRender,
  computed, contentChild, effect, inject, input, output, signal, viewChild, Injector,
} from '@angular/core';

/** Marks the HOST's own button (its scoped styles apply) as a pf-wf-menu trigger. */
@Directive({ selector: '[wfMenuTrigger]', standalone: true })
export class WfMenuTriggerDirective {
  readonly el = inject<ElementRef<HTMLButtonElement>>(ElementRef);
}

/** Moves its element to <body> while it lives, so no ancestor (a band with backdrop-filter, a scrolling card) can clip
 *  or re-anchor a fixed popover. Bindings and listeners stay attached. */
@Directive({ selector: '[wfPortal]', standalone: true })
export class WfPortalDirective implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  ngOnInit(): void { if (typeof document !== 'undefined') document.body.appendChild(this.el.nativeElement); }
  ngOnDestroy(): void { this.el.nativeElement.remove(); }
}

export interface WfMenuItem {
  id: string;
  label: string;
  hint?: string;
  /** A colour dot before the label (work areas). */
  dot?: string;
  /** Stroked SVG paths (24×24) before the label. */
  icon?: string[];
  group?: string;
  current?: boolean;
  disabled?: boolean;
}

/** Phones get a bottom sheet; wider screens a popover by the button. */
export const WF_SHEET_MQ = '(max-width: 640px)';
const W = 280;

/**
 * The workflow page's small menu (Workflow picker, Move to, Add action, Add role, area options): a popover by its
 * button, a bottom sheet on phones, portalled to <body>. Keyboard: Enter / Space / ↓ open, ↑ ↓ Home End move, Esc and
 * Tab close, focus returns to the button. It only emits the picked id.
 */
@Component({
  selector: 'pf-wf-menu',
  standalone: true,
  imports: [WfPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content />
    @if (open()) {
      <div wfPortal class="wfm-layer" [class.wfm-layer--sheet]="sheet()">
        <div class="wfm-backdrop" aria-hidden="true" (click)="close(false)"></div>
        <div #panel class="wfm" [class.wfm--sheet]="sheet()" role="menu" [attr.aria-label]="heading() || label()"
             [style.top.px]="sheet() ? null : pos().top" [style.left.px]="sheet() ? null : pos().left"
             [style.width.px]="sheet() ? null : width()" [attr.data-testid]="testId() ? testId() + '-menu' : null"
             (keydown)="onMenuKey($event)">
          @if (sheet()) { <span class="wfm-handle" aria-hidden="true"></span> }
          @if (heading()) { <p class="wfm-heading">{{ heading() }}</p> }
          <div class="wfm-scroll">
            @for (g of groups(); track $index; let first = $first) {
              @if (!first) { <div class="wfm-sep" role="separator"></div> }
              @if (g.name) { <p class="wfm-group" aria-hidden="true">{{ g.name }}</p> }
              @for (i of g.items; track i.id) {
                <button type="button" class="wfm-item" role="menuitem" tabindex="-1" [attr.data-id]="i.id"
                        [class.wfm-item--current]="i.current" [attr.aria-current]="i.current ? 'true' : null"
                        [disabled]="i.disabled" [attr.aria-disabled]="i.disabled || null" (click)="pick(i)">
                  @if (i.dot) { <span class="wfm-dot" [style.background]="i.dot" aria-hidden="true"></span> }
                  @if (i.icon) {
                    <svg class="wfm-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">@for (d of i.icon; track $index) { <path [attr.d]="d" /> }</svg>
                  }
                  <span class="wfm-txt"><span class="wfm-l">{{ i.label }}</span>@if (i.hint) { <span class="wfm-hint">{{ i.hint }}</span> }</span>
                  @if (i.current) {
                    <svg class="wfm-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  }
                </button>
              }
            } @empty {
              <p class="wfm-empty">{{ empty() }}</p>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: inline-flex; position: relative; min-width: 0; }
    .wfm-layer { position: fixed; inset: 0; z-index: 1150; }
    .wfm-backdrop { position: absolute; inset: 0; background: transparent; }
    .wfm-layer--sheet .wfm-backdrop { background: rgba(15, 23, 42, .32); }
    .wfm { position: fixed; display: flex; flex-direction: column; max-height: min(420px, calc(100dvh - 24px)); overflow: hidden;
      padding: 6px; border-radius: 14px; background: var(--bg-card-solid, #fff); color: var(--text-primary, #111827);
      border: 1px solid var(--pf-line, var(--border-muted, #e5e7eb)); box-shadow: 0 18px 48px rgba(15, 23, 42, .18), 0 2px 6px rgba(15, 23, 42, .08);
      font-size: 13.5px; }
    :host-context(.dark) .wfm, :host-context([data-theme='dark']) .wfm { box-shadow: 0 24px 60px rgba(0, 0, 0, .55); }
    .wfm--sheet { left: 0; right: 0; bottom: 0; top: auto; width: auto; max-height: 78dvh; border-radius: 18px 18px 0 0;
      padding: 8px 8px calc(12px + env(safe-area-inset-bottom)); }
    .wfm-handle { width: 40px; height: 4px; border-radius: 99px; background: var(--pf-line, #d1d5db); margin: 2px auto 8px; flex: none; }
    .wfm-heading { margin: 2px 10px 6px; font-size: 12px; color: var(--text-tertiary, #6b7280); }
    .wfm-scroll { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
    .wfm-group { margin: 6px 10px 2px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary, #6b7280); }
    .wfm-sep { height: 1px; margin: 6px 4px; background: var(--pf-line, var(--border-muted, #e5e7eb)); flex: none; }
    .wfm-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; padding: 6px 10px; border: 0; border-radius: 9px;
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .wfm-item:hover:not(:disabled), .wfm-item:focus-visible { background: var(--pf-chip-bg, #f3f4f6); outline: none; }
    .wfm-item:focus-visible { box-shadow: inset 0 0 0 2px var(--color-violet-600, #7c3aed); }
    .wfm-item:disabled { opacity: .45; cursor: not-allowed; }
    .wfm-item--current { background: var(--pf-sel-bg, #eceff2); }
    .wfm-dot { width: 9px; height: 9px; border-radius: 99px; flex: none; }
    .wfm-ic { flex: none; color: var(--text-secondary, #4b5563); }
    .wfm-txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .wfm-l { overflow-wrap: anywhere; }
    .wfm-hint { font-size: 12px; color: var(--text-tertiary, #6b7280); }
    .wfm-check { flex: none; color: var(--color-violet-600, #7c3aed); }
    .wfm-empty { margin: 8px 10px; font-size: 12.5px; color: var(--text-tertiary, #6b7280); }
    @media (pointer: coarse) { .wfm-item { min-height: 44px; } }
    @media (max-width: 640px) { .wfm { font-size: 15px; } }
  `],
})
export class WfMenuComponent {
  private readonly injector = inject(Injector);
  readonly items = input<WfMenuItem[]>([]);
  readonly label = input('');
  readonly heading = input('');
  readonly empty = input('Nothing to pick');
  readonly disabled = input(false);
  readonly align = input<'start' | 'end'>('end');
  readonly width = input(W);
  readonly testId = input('');
  readonly picked = output<string>();
  readonly opened = output<void>();

  readonly open = signal(false);
  readonly sheet = signal(false);
  readonly pos = signal({ top: 0, left: 0 });
  private readonly triggerDir = contentChild.required(WfMenuTriggerDirective);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private trigger(): ElementRef<HTMLButtonElement> { return this.triggerDir().el; }

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const b = this.trigger().nativeElement;
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      const onClick = () => this.toggle();
      const onKey = (e: KeyboardEvent) => this.onTriggerKey(e);
      b.addEventListener('click', onClick);
      b.addEventListener('keydown', onKey);
      destroy.onDestroy(() => { b.removeEventListener('click', onClick); b.removeEventListener('keydown', onKey); });
    });
    effect(() => {
      const open = this.open();
      const b = this.triggerDir()?.el.nativeElement;
      b?.setAttribute('aria-expanded', String(open));
    });
  }

  readonly groups = computed(() => {
    const out: { name: string; items: WfMenuItem[] }[] = [];
    for (const i of this.items()) {
      const g = i.group ?? '';
      if (!out.length || out[out.length - 1].name !== g) out.push({ name: g, items: [] });
      out[out.length - 1].items.push(i);
    }
    return out;
  });

  toggle(): void {
    if (this.trigger().nativeElement.disabled) return; if (this.open()) this.close(true); else this.show(); }

  show(focusLast = false): void {
    if (this.disabled() || this.trigger().nativeElement.disabled) return;
    this.sheet.set(typeof window !== 'undefined' && !!window.matchMedia?.(WF_SHEET_MQ).matches);
    this.place();
    this.open.set(true);
    this.opened.emit();
    afterNextRender(() => {
      this.place();
      const items = this.itemEls();
      const cur = items.find(b => b.getAttribute('aria-current') === 'true' && !b.disabled);
      (cur ?? (focusLast ? items[items.length - 1] : items[0]))?.focus();
    }, { injector: this.injector });
  }

  close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
  }

  pick(i: WfMenuItem): void {
    if (i.disabled) return;
    this.close(true);
    this.picked.emit(i.id);
  }

  private itemEls(): HTMLButtonElement[] {
    return Array.from(this.panel()?.nativeElement.querySelectorAll<HTMLButtonElement>('.wfm-item:not(:disabled)') ?? []);
  }

  private place(): void {
    if (typeof window === 'undefined') return;
    const r = this.trigger().nativeElement.getBoundingClientRect();
    const w = Math.min(this.width(), window.innerWidth - 16);
    const h = this.panel()?.nativeElement.offsetHeight ?? 240;
    let left = this.align() === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    this.pos.set({ top: Math.max(8, top), left });
  }

  onTriggerKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.show(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.show(true); }
  }

  onMenuKey(e: KeyboardEvent): void {
    const items = this.itemEls();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); this.close(true); }
    else if (e.key === 'Tab') this.close(false);
  }
}
