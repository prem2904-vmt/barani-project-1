import {
  ApplicationRef, ChangeDetectionStrategy, Component, ElementRef,
  EmbeddedViewRef, EventEmitter, HostListener, Input,
  OnDestroy, Output, TemplateRef, ViewChild, ViewContainerRef,
  ViewEncapsulation, inject, signal
} from '@angular/core';

export interface PfSelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface PfSelectOptGroup<T = string> {
  label: string;
  options: PfSelectOption<T>[];
}

export type PfSelectSize = 'sm' | 'md';

interface PanelPos { top: number; left: number; width: number; above: boolean; }

/**
 * Custom dropdown — no native <select> so iOS/macOS never shows OS wheel pickers.
 *
 * Clipping fix: the panel is portalled into a singleton overlay host that is
 * position:fixed; inset:0 on <body>. The panel itself is position:absolute
 * inside that host, making its coordinates viewport-relative without being
 * affected by backdrop-filter, overflow:hidden, or transforms on any ancestor.
 *
 * ViewEncapsulation.None: required because the panel DOM lives outside this
 * component's host element, so _ngcontent-scoped selectors would never match.
 */
@Component({
  selector: 'pf-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="pf-dd"
         [class.pf-dd--sm]="size === 'sm'"
         [class.pf-dd--open]="isOpen()"
         [class.pf-dd--disabled]="disabled">

      @if (multiple) {
        <!-- A <button> does NOT grow to contain wrapped flex/block children
             (they overflow its border-box), so the multi trigger is a div with
             combobox semantics — it expands normally as chips wrap. -->
        <div class="pf-dd__trigger pf-dd__trigger--multi"
             role="combobox"
             [attr.tabindex]="disabled ? -1 : 0"
             [attr.aria-expanded]="isOpen()"
             [attr.aria-disabled]="disabled"
             aria-haspopup="listbox"
             (click)="toggle($event)">
          @if (selectedOptions.length) {
            <span class="pf-dd__chips">
              @for (o of selectedOptions; track o.value) {
                <span class="pf-dd__chip">
                  <span class="pf-dd__chip-lbl">{{ o.label }}</span>
                  <span class="pf-dd__chip-x" role="button" tabindex="0" aria-label="Remove"
                        (click)="removeChip(o, $event)">✕</span>
                </span>
              }
            </span>
          } @else {
            <span class="pf-dd__value pf-dd__value--ph">{{ placeholder }}</span>
          }
          <svg class="pf-dd__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
      } @else if (searchable && isOpen()) {
        <!-- Combobox: while open, the trigger IS the search field. -->
        <div class="pf-dd__trigger pf-dd__trigger--combo" role="combobox" aria-expanded="true">
          <input type="text" class="pf-dd__combox"
                 [value]="search()" [placeholder]="displayLabel"
                 (input)="onSearchInput($any($event.target).value)"
                 (keydown)="onPanelKey($event)"
                 (click)="$event.stopPropagation()" />
          <svg class="pf-dd__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </div>
      } @else {
        <button type="button"
                class="pf-dd__trigger"
                [disabled]="disabled"
                [attr.aria-expanded]="isOpen()"
                aria-haspopup="listbox"
                (click)="toggle($event)">
          <span class="pf-dd__value" [class.pf-dd__value--ph]="!matched">{{ displayLabel }}</span>
          <svg class="pf-dd__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
      }
    </div>

    <ng-template #panelTpl>
      <div class="pf-dd__panel"
           [class.pf-dd__panel--sm]="size === 'sm'"
           [class.pf-dd__panel--above]="panelPos().above"
           [style.top.px]="panelPos().top"
           [style.left.px]="panelPos().left"
           [style.min-width.px]="panelPos().width"
           role="listbox"
           [attr.aria-label]="placeholder">
        @if (searchable && !groups?.length && visibleOpts().length === 0) {
          <div class="pf-dd__none">No matches</div>
        }
        @if (!groups?.length) {
          @for (opt of visibleOpts(); track opt.value; let idx = $index) {
            <button type="button" class="pf-dd__option" role="option"
                    [class.pf-dd__option--active]="isSelected(opt.value)"
                    [class.pf-dd__option--focused]="idx === focusedIndex()"
                    [attr.aria-selected]="isSelected(opt.value)"
                    [disabled]="opt.disabled ?? false"
                    (mouseenter)="focusedIndex.set(idx)"
                    (click)="pick(opt, $event)">
              @if (multiple) {
                <span class="pf-dd__box" [class.pf-dd__box--on]="isSelected(opt.value)" aria-hidden="true">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </span>
              }
              <span class="pf-dd__opt-label">{{ opt.label }}</span>
              @if (opt.hint) { <span class="pf-dd__hint">{{ opt.hint }}</span> }
            </button>
          }
        } @else {
          @for (g of groups; track g.label; let first = $first) {
            <div class="pf-dd__group" [class.pf-dd__group--first]="first">
              <p class="pf-dd__group-lbl">{{ g.label }}</p>
              @for (opt of g.options; track opt.value; let idx = $index) {
                <button type="button" class="pf-dd__option" role="option"
                        [class.pf-dd__option--active]="isSelected(opt.value)"
                        [class.pf-dd__option--focused]="idx === focusedIndex()"
                        [attr.aria-selected]="isSelected(opt.value)"
                        [disabled]="opt.disabled ?? false"
                        (mouseenter)="focusedIndex.set(idx)"
                        (click)="pick(opt, $event)">
                  @if (multiple) {
                    <span class="pf-dd__box" [class.pf-dd__box--on]="isSelected(opt.value)" aria-hidden="true">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    </span>
                  }
                  <span class="pf-dd__opt-label">{{ opt.label }}</span>
                </button>
              }
            </div>
          }
        }
      </div>
    </ng-template>
  `,
  styles: [`
    pf-select { display: block; }

    pf-select .pf-dd { position: relative; width: 100%; }

    pf-select .pf-dd__trigger {
      display: flex; align-items: center; gap: 6px; width: 100%; height: 38px;
      padding: 0 12px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 10px; font-size: 13.5px; font-family: inherit;
      cursor: pointer; text-align: left; outline: none; box-sizing: border-box;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    }
    pf-select .pf-dd--sm .pf-dd__trigger {
      height: 34px; padding: 0 10px; font-size: 13px; border-radius: 8px; gap: 4px;
    }
    pf-select .pf-dd__trigger:hover:not(:disabled) { border-color: var(--input-border-focus); }
    pf-select .pf-dd__trigger:focus,
    pf-select .pf-dd--open .pf-dd__trigger {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }
    pf-select .pf-dd--disabled .pf-dd__trigger { opacity: 0.55; cursor: not-allowed; }

    pf-select .pf-dd__value {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* Multi-select: chips live INSIDE the trigger so they fill the control.
       Block layout (not flex) so the trigger height always follows the wrapped
       chips; the chevron is absolutely pinned top-right and the right padding
       reserves room for it. */
    pf-select .pf-dd__trigger--multi {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      height: auto; min-height: 44px;
      padding: 6px 34px 6px 10px; position: relative;
    }
    pf-select .pf-dd__trigger--multi .pf-dd__chevron { position: absolute; right: 12px; top: 50%; margin-top: -7px; }
    pf-select .pf-dd--open .pf-dd__trigger--multi .pf-dd__chevron { transform: rotate(180deg); }
    pf-select .pf-dd__chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1 1 auto; min-width: 0; }
    pf-select .pf-dd__chip {
      display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
      padding: 3px 4px 3px 10px; border-radius: 999px; font-size: 13px; line-height: 1.3;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent);
      color: var(--text-primary, #0f172a); border: 1px solid var(--input-border, rgba(148,163,184,0.4));
    }
    pf-select .pf-dd__chip-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    pf-select .pf-dd__chip-x {
      flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 999px; cursor: pointer; font-size: 10px; line-height: 1;
      background: rgba(255,255,255,0.14); color: var(--text-secondary, #cbd5e1);
    }
    pf-select .pf-dd__chip-x:hover { background: rgba(255,255,255,0.26); color: var(--text-primary, #0f172a); }
    pf-select .pf-dd__value--ph { color: var(--text-tertiary, #94a3b8); }

    pf-select .pf-dd__chevron {
      flex-shrink: 0; color: var(--text-tertiary, #94a3b8);
      transition: transform 0.18s ease;
    }
    pf-select .pf-dd--open .pf-dd__chevron { transform: rotate(180deg); }

    /* ── Overlay host — singleton, viewport-pinned, on <body> ──────────── */
    #pf-overlay-host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9999;
      overflow: visible;
    }

    /* ── Panel — absolute inside the fixed host = viewport coordinates ─── */
    pf-select .pf-dd__trigger--combo { cursor: text; }
    pf-select .pf-dd__combox {
      flex: 1; min-width: 0; border: none; outline: none; background: transparent;
      font-size: inherit; font-family: inherit; color: var(--input-text);
      caret-color: var(--input-border-focus, #8b5cf6); padding: 0;
    }
    pf-select .pf-dd__combox::placeholder { color: var(--text-tertiary, #64748b); }
    .pf-dd__none { padding: 14px 12px; font-size: 12.5px; color: var(--text-tertiary, #64748b); text-align: center; }

    .pf-dd__panel {
      position: absolute;
      pointer-events: auto;
      width: max-content;
      max-width: min(460px, 92vw);
      max-height: 252px;
      overflow-y: auto;
      background: var(--bg-card-solid, #ffffff);
      border: 1px solid var(--input-border-focus, rgba(139, 92, 246, 0.35));
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.08);
      padding: 4px;
      overscroll-behavior: contain;
    }
    .pf-dd__panel--above { transform: translateY(-100%); }
    .pf-dd__panel::-webkit-scrollbar { width: 4px; }
    .pf-dd__panel::-webkit-scrollbar-track { background: transparent; }
    .pf-dd__panel::-webkit-scrollbar-thumb {
      background: rgba(139, 92, 246, 0.25); border-radius: 4px;
    }

    .pf-dd__option {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 2px 8px; width: 100%; padding: 7px 10px; font-size: inherit; font-family: inherit;
      color: var(--text-primary, #0f172a); background: transparent; border: none;
      border-radius: 8px; cursor: pointer; text-align: left;
      transition: background 0.1s ease; white-space: nowrap;
    }
    .pf-dd__opt-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .pf-dd__panel--sm .pf-dd__option { padding: 5px 8px; font-size: 12.5px; border-radius: 6px; }
    .pf-dd__option:hover:not(:disabled) { background: rgba(139, 92, 246, 0.07); }
    .pf-dd__option--focused:not(:disabled) {
      background: rgba(139, 92, 246, 0.12);
      outline: 1px dashed var(--color-primary, #7c3aed);
      outline-offset: -1px;
    }
    .pf-dd__option--active {
      background: rgba(139, 92, 246, 0.10); color: var(--color-primary, #7c3aed); font-weight: 600;
    }
    .pf-dd__option--active:hover:not(:disabled) { background: rgba(139, 92, 246, 0.14); }
    .pf-dd__option:disabled { opacity: 0.38; cursor: not-allowed; }
    .pf-dd__box {
      flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; border-radius: 5px;
      border: 1.5px solid var(--input-border, rgba(148,163,184,0.5)); color: transparent;
    }
    .pf-dd__box--on {
      background: var(--color-primary, #7c3aed); border-color: var(--color-primary, #7c3aed); color: #fff;
    }
    .pf-dd__opt-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .pf-dd__hint {
      flex-basis: 100%; min-width: 0; font-size: 11px; font-weight: 400;
      color: var(--text-tertiary, #64748b);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .pf-dd__group { border-top: 1px solid var(--border-muted, #e2e8f0); margin-top: 2px; padding-top: 2px; }
    .pf-dd__group--first { border-top: 0; margin-top: 0; padding-top: 0; }
    .pf-dd__group-lbl {
      margin: 0; padding: 5px 10px 3px; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary, #94a3b8);
    }
  `]
})
export class SelectComponent<T = unknown> implements OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly appRef = inject(ApplicationRef);

  @ViewChild('panelTpl') private readonly panelTpl!: TemplateRef<void>;
  private panelRef?: EmbeddedViewRef<void>;

  @Input({ required: true }) options: PfSelectOption<T>[] = [];
  @Input() groups?: PfSelectOptGroup<T>[];
  @Input() value!: T;
  @Input() placeholder = 'Select…';
  @Input() size: PfSelectSize = 'md';
  @Input() disabled = false;

  /** Multi-select mode: bind `values`/`valuesChange` instead of `value`/
   *  `valueChange`. Options show a checkbox and the panel stays open across
   *  picks. Single-select (default) behaviour is unchanged. */
  @Input() multiple = false;
  @Input() values: T[] = [];

  /** Searchable mode: a filter box pinned at the top of the panel narrows
   *  the options as you type (flat options only — grouped selects ignore
   *  it). Keyboard: arrows navigate the FILTERED list, Enter picks,
   *  Escape closes. Off by default so every existing select is unchanged. */
  @Input() searchable = false;
  readonly search = signal('');

  @Output() valueChange = new EventEmitter<T>();
  @Output() valuesChange = new EventEmitter<T[]>();

  readonly isOpen = signal(false);
  readonly panelPos = signal<PanelPos>({ top: 0, left: 0, width: 0, above: false });
  readonly focusedIndex = signal<number>(-1);

  private static readonly PANEL_MAX_H = 252;
  private static readonly GAP = 5;

  /** Singleton overlay host — one div on <body>, shared by all pf-select instances. */
  private static overlayHost: HTMLElement | null = null;
  private static getOverlayHost(): HTMLElement {
    if (!SelectComponent.overlayHost || !document.body.contains(SelectComponent.overlayHost)) {
      const host = document.createElement('div');
      host.id = 'pf-overlay-host';
      document.body.appendChild(host);
      SelectComponent.overlayHost = host;
    }
    return SelectComponent.overlayHost;
  }

  private get allOptions(): PfSelectOption<T>[] {
    return this.groups ? this.groups.flatMap(g => g.options) : this.options;
  }

  /** Options the panel actually shows — the search filter applied. */
  visibleOpts(): PfSelectOption<T>[] {
    const q = this.search().trim().toLowerCase();
    if (!this.searchable || !q) return this.options;
    return this.options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q));
  }
  /** The list keyboard navigation walks (filtered when searchable). */
  private get navOptions(): PfSelectOption<T>[] {
    return this.searchable && !this.groups?.length ? this.visibleOpts() : this.allOptions;
  }

  onSearchInput(v: string): void {
    this.search.set(v);
    this.focusedIndex.set(0);
    this.panelRef?.detectChanges();
  }

  /** Keys typed inside the panel's search box — the panel lives on <body>,
   *  so the host keydown listener never sees them. */
  onPanelKey(ev: KeyboardEvent): void {
    const list = this.navOptions;
    if (ev.key === 'ArrowDown' && list.length) {
      ev.preventDefault();
      this.focusedIndex.set((this.focusedIndex() + 1) % list.length);
      this.panelRef?.detectChanges();
      this.scrollFocusedIntoView();
    } else if (ev.key === 'ArrowUp' && list.length) {
      ev.preventDefault();
      this.focusedIndex.set((this.focusedIndex() - 1 + list.length) % list.length);
      this.panelRef?.detectChanges();
      this.scrollFocusedIntoView();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const idx = this.focusedIndex();
      if (idx >= 0 && idx < list.length) this.pick(list[idx], ev);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.closePanel();
    } else if (ev.key === 'Tab') {
      this.closePanel();
    }
  }

  get matched(): boolean {
    if (this.multiple) return (this.values?.length ?? 0) > 0;
    if (this.value === null || this.value === undefined) return false;
    return this.allOptions.some(o => String(o.value) === String(this.value));
  }

  get displayLabel(): string {
    if (this.multiple) {
      const sel = this.values ?? [];
      if (!sel.length) return this.placeholder;
      const labels = sel.map(v => this.allOptions.find(o => String(o.value) === String(v))?.label ?? String(v));
      return labels.length <= 2 ? labels.join(', ') : `${labels.length} selected`;
    }
    if (this.value === null || this.value === undefined) return this.placeholder;
    const opt = this.allOptions.find(o => String(o.value) === String(this.value));
    return opt?.label ?? this.placeholder;
  }

  isSelected(v: T): boolean {
    if (this.multiple) return (this.values ?? []).some(x => String(x) === String(v));
    if (this.value === null || this.value === undefined) return false;
    return String(v) === String(this.value);
  }

  /** Selected options as chips inside the trigger (multi mode), in option order. */
  get selectedOptions(): PfSelectOption<T>[] {
    if (!this.multiple) return [];
    const vals = (this.values ?? []).map(String);
    return this.allOptions.filter(o => vals.includes(String(o.value)));
  }

  /** Remove one chip without opening/closing the panel. */
  removeChip(opt: PfSelectOption<T>, ev: Event): void {
    ev.stopPropagation();
    const next = (this.values ?? []).filter(x => String(x) !== String(opt.value));
    this.values = next;
    this.valuesChange.emit(next);
  }

  toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.disabled) return;
    if (!this.isOpen()) { this.openPanel(); } else { this.closePanel(); }
  }

  pick(opt: PfSelectOption<T>, ev?: Event): void {
    if (ev) ev.stopPropagation();
    if (opt.disabled) return;
    if (this.multiple) {
      // Toggle membership; keep the panel open so several can be picked at once.
      const cur = this.values ?? [];
      const has = cur.some(x => String(x) === String(opt.value));
      const next = has ? cur.filter(x => String(x) !== String(opt.value)) : [...cur, opt.value];
      this.values = next;
      this.valuesChange.emit(next);
      this.panelRef?.detectChanges();
      return;
    }
    this.valueChange.emit(opt.value);
    this.closePanel();
  }

  private openPanel(): void {
    this.updatePanelPos();
    const selIdx = this.allOptions.findIndex((o) => this.isSelected(o.value));
    this.focusedIndex.set(selIdx >= 0 ? selIdx : 0);
    // Use TemplateRef.createEmbeddedView (not VCR) so no VCR re-anchors the node
    this.panelRef = this.panelTpl.createEmbeddedView(null as unknown as void);
    this.appRef.attachView(this.panelRef);
    this.panelRef.detectChanges();
    const panelEl = this.panelRef.rootNodes.find(
      (n: Node) => n.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement | undefined;
    if (panelEl) SelectComponent.getOverlayHost().appendChild(panelEl);
    this.isOpen.set(true);
    this.addScrollListeners();
    if (this.searchable && !this.groups?.length) {
      setTimeout(() =>
        (this.el.nativeElement.querySelector('.pf-dd__combox') as HTMLInputElement | null)?.focus(), 0);
    }
    this.scrollFocusedIntoView();
  }

  private closePanel(): void {
    this.removeScrollListeners();
    if (this.panelRef) {
      const panelEl = this.panelRef.rootNodes.find(
        (n: Node) => n.nodeType === Node.ELEMENT_NODE
      ) as HTMLElement | undefined;
      panelEl?.parentElement?.removeChild(panelEl);
      this.appRef.detachView(this.panelRef);
      this.panelRef.destroy();
      this.panelRef = undefined;
    }
    this.search.set('');
    this.isOpen.set(false);
  }

  private updatePanelPos(): void {
    const trigger = this.el.nativeElement.querySelector('.pf-dd__trigger') as HTMLElement | null;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < SelectComponent.PANEL_MAX_H + SelectComponent.GAP
               && r.top > spaceBelow;
    this.panelPos.set({
      top: above ? r.top - SelectComponent.GAP : r.bottom + SelectComponent.GAP,
      left: r.left,
      width: r.width,
      above
    });
  }

  private isTriggerVisible(trigger: HTMLElement): boolean {
    const r = trigger.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) {
      return false;
    }
    let parent = trigger.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') ||
                           (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden');
      if (isScrollable) {
        const pr = parent.getBoundingClientRect();
        if (r.bottom < pr.top || r.top > pr.bottom || r.right < pr.left || r.left > pr.right) {
          return false;
        }
      }
      parent = parent.parentElement;
    }
    return true;
  }

  private readonly onCaptureScroll = (ev: Event): void => {
    if (!this.isOpen()) return;

    // Ignore scroll events originating from inside the panel itself (e.g. scrolling the options list)
    const panelEl = this.panelRef?.rootNodes.find(
      (n: Node) => n.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement | undefined;
    if (panelEl && ev.target && panelEl.contains(ev.target as Node)) {
      return;
    }

    const trigger = this.el.nativeElement.querySelector('.pf-dd__trigger') as HTMLElement | null;
    if (!trigger || !this.isTriggerVisible(trigger)) {
      this.closePanel();
      return;
    }

    this.updatePanelPos();
  };

  private addScrollListeners(): void {
    window.addEventListener('scroll', this.onCaptureScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.onCaptureScroll, { capture: true, passive: true });
  }

  private removeScrollListeners(): void {
    window.removeEventListener('scroll', this.onCaptureScroll, true);
    window.removeEventListener('resize', this.onCaptureScroll, true);
  }

  ngOnDestroy(): void { this.closePanel(); }

  @HostListener('document:click', ['$event.target'])
  onDocClick(target: EventTarget | null): void {
    if (!this.isOpen()) return;
    const panelEl = this.panelRef?.rootNodes.find(
      (n: Node) => n.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement | undefined;
    const inTrigger = this.el.nativeElement.contains(target as Node | null);
    const inPanel = panelEl?.contains(target as Node | null) ?? false;
    if (!inTrigger && !inPanel) this.closePanel();
  }

  @HostListener('focusout', ['$event'])
  onFocusOut(ev: FocusEvent): void {
    const related = ev.relatedTarget as Node | null;
    const panelEl = this.panelRef?.rootNodes.find(
      (n: Node) => n.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement | undefined;
    if (!this.el.nativeElement.contains(related) && !(panelEl?.contains(related) ?? false)) {
      this.closePanel();
    }
  }

  @HostListener('keydown', ['$event'])
  onKey(ev: KeyboardEvent): void {
    if (this.disabled) return;

    if (!this.isOpen()) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        ev.stopPropagation();
        this.openPanel();
      }
      return;
    }

    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.closePanel();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      ev.stopPropagation();
      const count = this.navOptions.length;
      if (count > 0) {
        const next = (this.focusedIndex() + 1) % count;
        this.focusedIndex.set(next);
        this.panelRef?.detectChanges();
        this.scrollFocusedIntoView();
      }
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopPropagation();
      const count = this.navOptions.length;
      if (count > 0) {
        const next = (this.focusedIndex() - 1 + count) % count;
        this.focusedIndex.set(next);
        this.panelRef?.detectChanges();
        this.scrollFocusedIntoView();
      }
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      ev.stopPropagation();
      const idx = this.focusedIndex();
      if (idx >= 0 && idx < this.navOptions.length) {
        this.pick(this.navOptions[idx], ev);
      } else {
        this.closePanel();
      }
    } else if (ev.key === 'Tab') {
      this.closePanel();
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const char = ev.key.toLowerCase();
      const matchIdx = this.allOptions.findIndex((o) =>
        o.label.toLowerCase().startsWith(char)
      );
      if (matchIdx >= 0) {
        this.focusedIndex.set(matchIdx);
        this.panelRef?.detectChanges();
        this.scrollFocusedIntoView();
      }
    }
  }

  private scrollFocusedIntoView(): void {
    setTimeout(() => {
      if (!this.panelRef) return;
      const panelEl = this.panelRef.rootNodes.find(
        (n: Node) => n.nodeType === Node.ELEMENT_NODE
      ) as HTMLElement | undefined;
      if (!panelEl) return;
      const focusedOpt = panelEl.querySelector(
        '.pf-dd__option--focused'
      ) as HTMLElement | null;
      focusedOpt?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }
}
