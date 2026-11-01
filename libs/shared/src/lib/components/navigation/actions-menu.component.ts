import {
  ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, Injector, afterNextRender, computed,
  contentChild, effect, inject, input, output, signal, viewChild, viewChildren,
} from '@angular/core';
import { ModalPortalDirective } from '../../directives/modal-portal.directive.js';

/** The stroked icon set a menu row can carry (24×24, currentColor). */
export type PfActionIcon =
  | 'share' | 'whatsapp' | 'link' | 'download' | 'print' | 'chat' | 'edit' | 'regenerate'
  | 'patient' | 'lab' | 'reassign' | 'sendback' | 'view' | 'repeat' | 'referral';

/** One row of a `pf-actions-menu`. Screens build the list from the user's
 *  permissions and the record's state — the menu renders what it is given
 *  and never decides what is allowed. */
export interface PfAction {
  id: string;
  label: string;
  icon?: PfActionIcon;
  /** Section heading ("Share", "Report", "Workflow"). Rows keep the order
   *  they arrive in; a new group starts wherever the group name changes. */
  group?: string;
  /** Destructive / state-changing wording in red. The HOST still owns the
   *  DialogService confirm — the menu never skips one. */
  tone?: 'danger';
  disabled?: boolean;
  /** One quiet line under the label ("Opens WhatsApp with the report link"). */
  hint?: string;
  /** The row for what is on screen right now (a navigation menu such as the
   *  draft tray's overflow): `aria-current="page"` + the quiet selected look.
   *  Still pickable — the host decides that picking it is a no-op. */
  current?: boolean;
}

/** Stroked paths per icon — never emoji (docs/PF-PATTERN.md §10). */
const ICONS: Record<PfActionIcon, string[]> = {
  share: ['M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7', 'M12 15V3', 'm8 7 4-4 4 4'],
  whatsapp: ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  print: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
  regenerate: ['M21 12a9 9 0 0 1-15 6.7L3 16', 'M3 21v-5h5', 'M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5'],
  patient: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  lab: ['M9 3h6', 'M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3', 'M7 15h10'],
  reassign: ['M16 3l4 4-4 4', 'M20 7H4', 'M8 21l-4-4 4-4', 'M4 17h16'],
  sendback: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  view: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  repeat: ['M3 2v6h6', 'M21 12A9 9 0 0 0 6 5.3L3 8', 'M21 22v-6h-6', 'M3 12a9 9 0 0 0 15 6.7l3-2.7'],
  // Stethoscope — the referring doctor (Edit referral).
  referral: ['M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1', 'M5 2v2', 'M11 2v2', 'M8 15a6 6 0 0 0 12 0v-3', 'M18 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0'],
};

/** Phones get a bottom sheet; tablets and desktop a popover by the button. */
export const ACTIONS_MENU_SHEET_MQ = '(max-width: 640px)';
const POP_W = 296;
const GAP = 6;
const EDGE = 8;

interface Section { group: string; items: PfAction[] }

let seq = 0;

/** Mark a HOST-styled button as the menu's trigger:
 *  `<pf-actions-menu …><button pfActionsTrigger class="pf-rowact">…</button></pf-actions-menu>`.
 *  The button stays in the host's template, so the host's own (scoped)
 *  button styles apply; the menu wires click, keys and ARIA onto it. */
@Directive({ selector: '[pfActionsTrigger]', standalone: true })
export class ActionsMenuTriggerDirective {
  readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
}

/**
 * `pf-actions-menu` — the ONE ⋮ (kebab) menu: a secondary-actions home next
 * to a screen's primary CTA (PF-PATTERN: "primary only for the CTA").
 *
 * - Trigger: an icon button (vertical dots) with an aria-label, 44px on touch.
 *   Either the built-in one (`triggerClass` = global kit classes such as
 *   `.pf-rowact` / `.pf-btn`) or the host's own button marked
 *   `pfActionsTrigger` (projected — keeps the host's scoped styles).
 * - Popover on tablet / desktop (fixed, measured from the trigger, flips above
 *   when there is no room); a bottom SHEET on phones (≤640px: handle, dim
 *   backdrop, Cancel, above the navbar + safe area). Portalled to <body> so no
 *   ancestor (sticky band, backdrop-filter) can clip or trap it.
 * - Keyboard: Enter / Space / ↓ open on the first row, ↑ on the last; ↑ ↓
 *   Home End move; Esc (and Tab) close; focus returns to the trigger.
 * - It only EMITS `(action)` with the row id, after closing. The host runs its
 *   existing handler — its own permission checks and DialogService confirms.
 */
@Component({
  selector: 'pf-actions-menu',
  standalone: true,
  imports: [ModalPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content />
    @if (!projected()) {
      <button #trigger type="button" class="pf-am-trigger" [class]="triggerClass()"
              [attr.aria-label]="label()" [attr.title]="label()" aria-haspopup="menu"
              [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? menuId : null"
              [disabled]="!actions().length"
              (click)="toggle()" (keydown)="onTriggerKey($event)">
        <svg class="pf-am-trigger__i" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5h.01"/><path d="M12 12h.01"/><path d="M12 19h.01"/>
        </svg>
        @if (labelClass()) { <span [class]="labelClass()">{{ triggerText() || label() }}</span> }
      </button>
    }

    @if (open()) {
      <div class="pf-am-layer" pfModalPortal [class.pf-am-layer--sheet]="sheet()">
        <div class="pf-am-backdrop" aria-hidden="true" (click)="close(false)"></div>
        <div #panel class="pf-am-panel" [class.pf-am-panel--sheet]="sheet()" [class.pf-am-panel--placed]="placed()"
             [id]="menuId" role="menu" [attr.aria-label]="heading() || label()"
             [style.top.px]="sheet() ? null : pos().top" [style.left.px]="sheet() ? null : pos().left"
             [style.width.px]="sheet() ? null : width()" [class.pf-am-panel--start]="align() === 'start'"
             (keydown)="onMenuKey($event)">
          @if (sheet()) {
            <span class="pf-am-handle" aria-hidden="true"></span>
            @if (heading()) { <p class="pf-am-heading">{{ heading() }}</p> }
          }
          <div class="pf-am-scroll">
            @for (s of sections(); track $index; let first = $first) {
              @if (!first) { <div class="pf-am-sep" role="separator"></div> }
              <div class="pf-am-group" role="group" [attr.aria-label]="s.group || null">
                @if (s.group) { <p class="pf-am-group__t" aria-hidden="true">{{ s.group }}</p> }
                @for (a of s.items; track a.id) {
                  <button #item type="button" [attr.role]="checkCurrent() ? 'menuitemradio' : 'menuitem'" class="pf-am-item" tabindex="-1"
                          [attr.data-action]="a.id" [class.pf-am-item--danger]="a.tone === 'danger'"
                          [class.pf-am-item--current]="a.current && !checkCurrent()"
                          [attr.aria-current]="a.current && !checkCurrent() ? 'page' : null"
                          [attr.aria-checked]="checkCurrent() ? !!a.current : null"
                          [disabled]="a.disabled" [attr.aria-disabled]="a.disabled || null"
                          (click)="pick(a)">
                    @if (a.icon) {
                      <svg class="pf-am-item__i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        @for (d of iconPaths(a.icon); track $index) { <path [attr.d]="d"/> }
                      </svg>
                    }
                    <span class="pf-am-item__txt">
                      <span class="pf-am-item__t">{{ a.label }}</span>
                      @if (a.hint) { <span class="pf-am-item__hint">{{ a.hint }}</span> }
                    </span>
                    @if (checkCurrent() && a.current) {
                      <svg class="pf-am-item__check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                    }
                  </button>
                }
              </div>
            }
          </div>
          @if (sheet()) {
            <div class="pf-am-foot">
              <button type="button" class="pf-btn pf-btn--secondary pf-am-cancel" (click)="close(true)">Cancel</button>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: inline-flex; position: relative; }
    .pf-am-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    /* The ⋮ always shows (even where .pf-rowact hides row icons on web). */
    .pf-am-trigger > .pf-am-trigger__i { display: block; flex: none; }

    .pf-am-layer { position: fixed; inset: 0; z-index: 125; }
    .pf-am-backdrop { position: absolute; inset: 0; background: transparent; }

    .pf-am-panel {
      position: fixed; width: 296px; max-width: calc(100vw - 16px);
      max-height: min(calc(100vh - 16px), 680px); display: flex; flex-direction: column;
      padding: 6px; border-radius: 14px;
      background: var(--pf-card-bg, var(--bg-card-solid, #fff)); color: var(--text-primary);
      border: 1px solid var(--pf-line, var(--border-muted, #e5e7eb));
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
      visibility: hidden; opacity: 0; transform: translateY(-4px) scale(0.98); transform-origin: top right;
      transition: opacity var(--pf-dur-fast, 200ms) ease, transform var(--pf-dur, 320ms) var(--pf-spring, ease);
    }
    .pf-am-panel--start { transform-origin: bottom left; }
    .pf-am-panel--placed { visibility: visible; opacity: 1; transform: none; }
    .pf-am-scroll { overflow-y: auto; overscroll-behavior: contain; min-height: 0; }

    .pf-am-group__t {
      margin: 0; padding: 8px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--text-tertiary);
    }
    .pf-am-sep { height: 1px; margin: 6px 4px; background: var(--pf-line, var(--border-muted, #e5e7eb)); }

    .pf-am-item {
      width: 100%; min-height: 44px; display: flex; align-items: center; gap: 12px; padding: 8px 10px;
      border: 0; border-radius: 10px; background: transparent; color: var(--text-primary);
      font: inherit; font-size: 14px; text-align: left; cursor: pointer;
    }
    .pf-am-item__i { flex: none; color: var(--text-secondary); }
    .pf-am-item__check { flex: none; margin-left: auto; color: var(--text-primary); }
    .pf-am-item__txt { display: flex; flex-direction: column; min-width: 0; }
    .pf-am-item__t { line-height: 1.3; }
    .pf-am-item__hint { font-size: 12px; line-height: 1.3; color: var(--text-tertiary); }
    .pf-am-item:hover:not(:disabled), .pf-am-item:focus-visible { background: var(--pf-chip-bg, rgba(15, 23, 42, 0.05)); outline: none; }
    .pf-am-item:focus-visible { box-shadow: inset 0 0 0 2px var(--color-violet-600, #7c3aed); }
    .pf-am-item:disabled { opacity: 0.5; cursor: not-allowed; }
    .pf-am-item--danger, .pf-am-item--danger .pf-am-item__i { color: var(--red-text, #dc2626); }
    /* IDs / sample numbers line up (tabular figures, same Noto Sans). */
    .pf-am-item__t { font-variant-numeric: tabular-nums; }
    /* Current row: the app's quiet selected look (violet tint + ink). */
    .pf-am-item--current { background: color-mix(in srgb, var(--color-primary, #7c3aed) 9%, transparent); }
    .pf-am-item--current .pf-am-item__t { color: var(--violet-text, #6d28d9); font-weight: 600; }  /* --violet-text is theme-aware (light #6d28d9 / dark #c4b5fd) */
    .pf-am-item--current .pf-am-item__i { color: var(--violet-text, #7c3aed); }

    /* ── Phones: bottom sheet above the navbar (pf-sheet language) ── */
    .pf-am-layer--sheet .pf-am-backdrop { background: rgba(0, 0, 0, 0.45); bottom: var(--pf-nav-h, 0px); animation: pf-am-fade var(--pf-dur-fast, 200ms) ease both; }
    .pf-am-panel--sheet {
      left: 0; right: 0; bottom: var(--pf-nav-h, 0px); top: auto; width: auto; max-width: none;
      max-height: calc(100dvh - env(safe-area-inset-top, 0px) - var(--pf-nav-h, 0px) - 24px);
      border-radius: 20px 20px 0 0; border-bottom: 0; padding: 0 8px;
      box-shadow: 0 -12px 40px rgba(15, 23, 42, 0.22);
      visibility: visible; opacity: 1; transform: none;
      animation: pf-am-rise var(--pf-dur-sheet, 360ms) var(--pf-spring-bounce, ease) both;
    }
    .pf-am-handle { display: block; flex: none; width: 40px; height: 5px; margin: 8px auto 4px; border-radius: 999px; background: var(--pf-line, #e5e7eb); }
    .pf-am-heading { margin: 0; padding: 4px 12px 6px; font-size: 13px; font-weight: 600; color: var(--text-secondary); text-align: center; }
    .pf-am-panel--sheet .pf-am-item { min-height: 48px; font-size: 16px; }
    .pf-am-foot { flex: none; display: flex; padding: 8px 4px calc(10px + env(safe-area-inset-bottom, 0px)); }
    .pf-am-cancel { flex: 1 1 auto; min-height: 48px; }

    @keyframes pf-am-rise { from { transform: translateY(100%); } to { transform: none; } }
    @keyframes pf-am-fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .pf-am-panel, .pf-am-panel--sheet, .pf-am-layer--sheet .pf-am-backdrop { transition: none; animation: none; transform: none; }
    }
  `],
})
export class ActionsMenuComponent {
  private readonly injector = inject(Injector);

  /** The rows, already filtered by the host's permission + state rules. */
  readonly actions = input<PfAction[]>([]);
  /** Accessible name of the ⋮ button (and the menu). */
  readonly label = input('More actions');
  /** Optional visible text next to the ⋮ (defaults to `label`). */
  readonly triggerText = input('');
  /** Host's button classes (`pf-rowact pf-rowact--icon`, `pf-hb-btn …`). */
  readonly triggerClass = input('pf-btn pf-btn--icon');
  /** Class for the trigger's text span; empty = icon only (label via aria). */
  readonly labelClass = input('');
  /** Sheet title on phones ("Report · Priya Nair"). */
  readonly heading = input('');
  /** Popover edge that lines up with the trigger: `end` (right, the ⋮
   *  default) or `start` (left — a trigger at the left of a bar). */
  readonly align = input<'start' | 'end'>('end');
  /** Open above the trigger when it fits (a trigger at the bottom of a
   *  panel, e.g. a composer); default below, flipping above only if needed. */
  readonly prefer = input<'below' | 'above'>('below');
  /** A pick-one list (e.g. the Cortex model): rows are `menuitemradio`,
   *  the `current` row carries a quiet trailing check instead of the tint. */
  readonly checkCurrent = input(false);
  /** Popover width in px (phones always get the full-width sheet). */
  readonly width = input(POP_W);

  /** The chosen row's id — emitted AFTER the menu closed. */
  readonly action = output<string>();
  /** The menu opened (hosts prefetch what a row will need, e.g. a link). */
  readonly opened = output<void>();

  readonly open = signal(false);
  readonly sheet = signal(false);
  readonly placed = signal(false);
  readonly pos = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  readonly menuId = `pf-am-${++seq}`;

  private readonly ownTrigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  /** A host button marked `pfActionsTrigger`, if one was projected. */
  readonly projected = contentChild(ActionsMenuTriggerDirective);
  private triggerEl(): HTMLElement | null {
    return this.projected()?.el.nativeElement ?? this.ownTrigger()?.nativeElement ?? null;
  }
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly items = viewChildren<ElementRef<HTMLButtonElement>>('item');

  readonly sections = computed<Section[]>(() => {
    const out: Section[] = [];
    for (const a of this.actions()) {
      const g = a.group ?? '';
      const last = out[out.length - 1];
      if (last && last.group === g) last.items.push(a);
      else out.push({ group: g, items: [a] });
    }
    return out;
  });

  constructor() {
    // Projected trigger: wire click + keys once, keep its ARIA in sync.
    let wired: HTMLElement | null = null;
    const onClick = () => this.toggle();
    const onKey = (ev: KeyboardEvent) => this.onTriggerKey(ev);
    effect(() => {
      const el = this.projected()?.el.nativeElement ?? null;
      if (el !== wired) {
        wired?.removeEventListener('click', onClick);
        wired?.removeEventListener('keydown', onKey);
        el?.addEventListener('click', onClick);
        el?.addEventListener('keydown', onKey);
        wired = el;
      }
      if (!el) return;
      el.setAttribute('aria-haspopup', 'menu');
      el.setAttribute('aria-expanded', String(this.open()));
      if (this.open()) el.setAttribute('aria-controls', this.menuId); else el.removeAttribute('aria-controls');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', this.label());
    });
    inject(DestroyRef).onDestroy(() => {
      wired?.removeEventListener('click', onClick);
      wired?.removeEventListener('keydown', onKey);
    });
    const onResize = () => { if (this.open()) this.close(false); };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
      inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', onResize));
    }
  }

  iconPaths(icon: PfActionIcon): string[] { return ICONS[icon] ?? []; }

  toggle(): void { this.open() ? this.close(true) : this.show('first'); }

  onTriggerKey(ev: KeyboardEvent): void {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.show(ev.key === 'ArrowUp' ? 'last' : 'first');
    }
  }

  /** Open, place, and put focus on the first (or last) enabled row. */
  show(focus: 'first' | 'last' = 'first'): void {
    if (!this.actions().length) return;
    this.sheet.set(matches(ACTIONS_MENU_SHEET_MQ));
    this.placed.set(this.sheet());
    this.open.set(true);
    this.opened.emit();
    afterNextRender(() => {
      if (!this.open()) return;
      if (!this.sheet()) this.place();
      this.focusAt(focus === 'first' ? 0 : this.enabledItems().length - 1);
    }, { injector: this.injector });
  }

  /** Close; `refocus` returns focus to the ⋮ (Esc, Cancel, a pick). */
  close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.placed.set(false);
    if (refocus) this.triggerEl()?.focus();
  }

  pick(a: PfAction): void {
    if (a.disabled) return;
    this.close(true);
    this.action.emit(a.id);
  }

  onMenuKey(ev: KeyboardEvent): void {
    const list = this.enabledItems();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); this.focusAt(i < 0 ? 0 : (i + 1) % list.length); break;
      case 'ArrowUp': ev.preventDefault(); this.focusAt(i <= 0 ? list.length - 1 : i - 1); break;
      case 'Home': ev.preventDefault(); this.focusAt(0); break;
      case 'End': ev.preventDefault(); this.focusAt(list.length - 1); break;
      case 'Escape': ev.preventDefault(); ev.stopPropagation(); this.close(true); break;
      case 'Tab': this.close(true); break;
    }
  }

  private enabledItems(): HTMLButtonElement[] {
    return this.items().map(r => r.nativeElement).filter(b => !b.disabled);
  }

  private focusAt(i: number): void {
    const list = this.enabledItems();
    if (!list.length) return;
    list[Math.max(0, Math.min(i, list.length - 1))].focus();
  }

  /** Right-align under the ⋮ (or left-align for `align="start"`), clamp to
   *  the viewport, flip above if needed. */
  private place(): void {
    const el = this.triggerEl();
    if (!el) return;
    const t = el.getBoundingClientRect();
    const p = this.panel()?.nativeElement;
    const w = p?.offsetWidth || this.width();
    const h = p?.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const want = this.align() === 'start' ? t.left : t.right - w;
    const left = Math.min(Math.max(EDGE, want), Math.max(EDGE, vw - w - EDGE));
    const below = t.bottom + GAP;
    const above = t.top - GAP - h;
    const fitsAbove = above >= EDGE;
    const top = (this.prefer() === 'above' && fitsAbove) || (below + h > vh - EDGE && fitsAbove)
      ? above : Math.max(EDGE, Math.min(below, vh - h - EDGE));
    this.pos.set({ top, left });
    this.placed.set(true);
  }
}

function matches(q: string): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.(q).matches; } catch { return false; }
}
