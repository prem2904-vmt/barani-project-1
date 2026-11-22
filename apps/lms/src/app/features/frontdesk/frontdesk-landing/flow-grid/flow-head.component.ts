import { afterNextRender, ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, inject, viewChild } from '@angular/core';
import type { IHeaderParams } from 'ag-grid-community';
import { ActionsMenuComponent, ActionsMenuTriggerDirective, PfAction } from '../../../../shared/components/actions-menu/actions-menu.component';
import type { FlowGridContext } from './flow-cells';

/** How a header behaves: the settings preview edits columns, the Frontdesk may let a person hide one. */
export type FlowHeadMode = 'plain' | 'staff' | 'edit';

export interface FlowHeadParams {
  /** The catalogue column behind this AG column (fd-grid-columns.ts). */
  fdId: string;
  locked: boolean;
  mode: FlowHeadMode;
  /** The visible label (the column's header name). */
  label: string;
}

type P = IHeaderParams & FlowHeadParams & { context: FlowGridContext };

const GRIP = 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01';

/**
 * The flow grid's INNER header (AG-Grid `headerComponentParams.innerHeaderComponent`: the grid keeps its own sort /
 * filter icons, this draws only the label part).
 *  - plain: the label, exactly as before.
 *  - staff (the admin lets staff hide columns): "Hide column" (and "Show all columns" once some are hidden), saved for
 *    this person only. A click on the label SORTS, exactly like every other grid (release gate 2026-11-21: the label
 *    used to be the menu button too, so every sort click also opened the menu and its invisible backdrop swallowed the
 *    next click). The Column menu opens on a right-click, a press-and-hold (touch) or the context-menu key /
 *    Shift+F10 on the focused header.
 *  - edit (Settings › Work grid columns preview): grip + label + ✕ (lock for Token / Patient / Next); drag with a
 *    pointer (mouse or touch), Alt+← / Alt+→ on the focused header. The settings page owns the drag (ctx.columnEdit).
 */
@Component({
  selector: 'pf-fd-flow-head',
  standalone: true,
  imports: [ActionsMenuComponent, ActionsMenuTriggerDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.fd-hd-host--edit]': "p?.mode === 'edit'" },
  template: `
    @if (p; as h) {
      @if (h.mode === 'edit') {
        <span class="fd-hd fd-hd--edit" [class.fd-hd--lock]="h.locked" [attr.data-fd-head]="h.fdId"
          [attr.tabindex]="h.locked ? null : 0" [attr.role]="h.locked ? null : 'button'"
          [attr.aria-label]="h.locked ? h.label + ', always shown' : h.label + '. Drag to move, Alt plus arrow left or right moves it, Delete removes it.'"
          (pointerdown)="down($event)" (keydown)="key($event)">
          @if (!h.locked) {
            <svg class="fd-hd__grip" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path [attr.d]="grip" /></svg>
          }
          <span class="fd-hd__label">{{ h.label }}</span>
          @if (h.locked) {
            <svg class="fd-hd__lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><title>Always shown</title><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          } @else {
            <button type="button" class="fd-hd__x" [attr.data-fd-remove]="h.fdId" [attr.aria-label]="'Remove ' + h.label" title="Remove"
              tabindex="-1" (pointerdown)="$event.stopPropagation()" (click)="remove($event)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          }
        </span>
      } @else {
        <span class="fd-hd" [attr.data-fd-menu]="h.mode === 'staff' && !h.locked ? h.fdId : null">
          <span class="fd-hd__label">{{ h.label }}</span>
          @if (h.mode === 'staff' && !h.locked) {
            <!-- The label stays a plain label (a click sorts). The menu opens from contextmenu / press-and-hold / keys
                 (see agInit); this zero-width anchor only places it, it never takes a click. -->
            <pf-actions-menu class="fd-hd__menu" [actions]="menu" heading="Column" [label]="h.label + ', column options'" (action)="pick($event)">
              <span pfActionsTrigger class="fd-hd__anchor" aria-hidden="true"></span>
            </pf-actions-menu>
          }
        </span>
      }
    }`,
  styles: [`
    :host { display: flex; align-items: center; min-width: 0; flex: 0 1 auto; height: 100%; }
    :host(.fd-hd-host--edit) { flex: 1 1 auto; }
    .fd-hd { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; height: 100%; }
    .fd-hd__label { white-space: nowrap; flex: none; }
    .fd-hd--edit { flex: 1 1 auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; border-radius: 6px; padding: 0 2px; }
    .fd-hd--edit:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 2px; }
    .fd-hd--lock { cursor: default; }
    .fd-hd__grip { color: var(--text-tertiary); flex: none; }
    .fd-hd__lock { color: var(--text-tertiary); flex: none; }
    .fd-hd__x { margin-left: auto; flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 7px;
      background: transparent; color: var(--text-tertiary); cursor: pointer; position: relative; }
    .fd-hd__x:hover { color: var(--text-primary); background: var(--pf-chip-bg); }
    .fd-hd__x:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 1px; }
    /* Touch: a 44px hit area around the 22px ✕ (never 44px of width — labels keep their room). */
    @media (pointer: coarse) { .fd-hd__x::after { content: ''; position: absolute; inset: -11px; } }
    /* The menu's anchor: zero width (header widths stay exactly the plain label's), never hit-testable. */
    .fd-hd__menu { display: inline-flex; width: 0; height: 24px; margin-left: -6px; overflow: visible; pointer-events: none; }
    .fd-hd__anchor { display: block; width: 0; height: 24px; pointer-events: none; }
  `],
})
export class FlowHeadComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly colMenu = viewChild(ActionsMenuComponent);
  p: P | null = null;
  menu: PfAction[] = [];
  readonly grip = GRIP;

  constructor() {
    // The Column menu (staff mode) opens from the WHOLE header cell: right-click, press-and-hold, ContextMenu / Shift+F10.
    // A plain click is left to AG-Grid (sort). A hold that opened the menu swallows the click that follows it.
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const cell = this.el.nativeElement.closest('.ag-header-cell') as HTMLElement | null;
      if (!cell) return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let start: { x: number; y: number } | null = null;
      const cancel = () => { if (timer) clearTimeout(timer); timer = null; start = null; };
      const swallowNextClick = () => {
        const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
        cell.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => cell.removeEventListener('click', stop, { capture: true }), 800);
      };
      const onContext = (e: MouseEvent) => {
        if (!this.staffMenu() || (e.target as HTMLElement)?.closest('.ag-header-cell-filter-button')) return;
        e.preventDefault();
        this.openMenu();
      };
      const onKey = (e: KeyboardEvent) => {
        if (!this.staffMenu() || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
        e.preventDefault(); e.stopPropagation();
        this.openMenu();
      };
      const onDown = (e: PointerEvent) => {
        if (!this.staffMenu() || e.pointerType === 'mouse' || (e.target as HTMLElement)?.closest('.ag-header-cell-filter-button')) return;
        cancel();
        start = { x: e.clientX, y: e.clientY };
        timer = setTimeout(() => { timer = null; swallowNextClick(); this.openMenu(); }, 550);
      };
      const onMove = (e: PointerEvent) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); };
      cell.addEventListener('contextmenu', onContext);
      cell.addEventListener('keydown', onKey);
      cell.addEventListener('pointerdown', onDown);
      cell.addEventListener('pointermove', onMove);
      cell.addEventListener('pointerup', cancel);
      cell.addEventListener('pointercancel', cancel);
      destroy.onDestroy(() => {
        cancel();
        cell.removeEventListener('contextmenu', onContext);
        cell.removeEventListener('keydown', onKey);
        cell.removeEventListener('pointerdown', onDown);
        cell.removeEventListener('pointermove', onMove);
        cell.removeEventListener('pointerup', cancel);
        cell.removeEventListener('pointercancel', cancel);
      });
    });
  }

  private staffMenu(): boolean { return this.p?.mode === 'staff' && !this.p.locked && !!this.colMenu(); }
  private openMenu(): void { const m = this.colMenu(); if (m && !m.open()) m.show('first'); }

  agInit(p: P): void {
    this.p = p;
    const hidden = p.context?.columnHide?.hiddenCount() ?? 0;
    this.menu = [
      { id: 'hide', label: 'Hide column', hint: 'Only for you, on this browser' },
      ...(hidden ? [{ id: 'show-all', label: hidden === 1 ? 'Show the hidden column' : `Show ${hidden} hidden columns`, icon: 'view' as const }] : []),
    ];
    this.cdr.markForCheck();
  }
  refresh(p: P): boolean { this.agInit(p); return true; }

  down(ev: PointerEvent): void {
    const h = this.p;
    if (!h || h.locked || h.mode !== 'edit') return;
    h.context?.columnEdit?.start(ev, h.fdId, this.el.nativeElement.closest('.ag-header-cell') as HTMLElement ?? this.el.nativeElement);
  }
  key(ev: KeyboardEvent): void {
    const h = this.p;
    if (!h || h.locked) return;
    h.context?.columnEdit?.key(ev, h.fdId);
  }
  remove(ev: MouseEvent): void {
    ev.stopPropagation();
    const h = this.p;
    if (h && !h.locked) h.context?.columnEdit?.remove(h.fdId);
  }
  pick(id: string): void {
    const h = this.p;
    if (!h) return;
    if (id === 'hide') h.context?.columnHide?.hide(h.fdId);
    if (id === 'show-all') h.context?.columnHide?.showAll();
  }
}
