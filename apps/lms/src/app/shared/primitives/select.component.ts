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
        @if (!groups?.length) {
          @for (opt of options; track opt.value) {
            <button type="button" class="pf-dd__option" role="option"
                    [class.pf-dd__option--active]="isSelected(opt.value)"
                    [attr.aria-selected]="isSelected(opt.value)"
                    [disabled]="opt.disabled ?? false"
                    (click)="pick(opt, $event)">
              <span class="pf-dd__opt-label">{{ opt.label }}</span>
              @if (opt.hint) { <span class="pf-dd__hint">{{ opt.hint }}</span> }
            </button>
          }
        } @else {
          @for (g of groups; track g.label; let first = $first) {
            <div class="pf-dd__group" [class.pf-dd__group--first]="first">
              <p class="pf-dd__group-lbl">{{ g.label }}</p>
              @for (opt of g.options; track opt.value) {
                <button type="button" class="pf-dd__option" role="option"
                        [class.pf-dd__option--active]="isSelected(opt.value)"
                        [attr.aria-selected]="isSelected(opt.value)"
                        [disabled]="opt.disabled ?? false"
                        (click)="pick(opt, $event)">
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
      display: flex; align-items: center; gap: 6px; width: 100%;
      padding: 0.625rem 0.875rem;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 12px; font-size: 0.9375rem; font-family: inherit;
      cursor: pointer; text-align: left; outline: none;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    }
    pf-select .pf-dd--sm .pf-dd__trigger {
      padding: 0.375rem 0.75rem; font-size: 13px; border-radius: 10px; gap: 4px;
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
    .pf-dd__panel {
      position: absolute;
      pointer-events: auto;
      width: max-content;
      max-width: min(320px, 90vw);
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
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      width: 100%; padding: 7px 10px; font-size: inherit; font-family: inherit;
      color: var(--text-primary, #0f172a); background: transparent; border: none;
      border-radius: 8px; cursor: pointer; text-align: left;
      transition: background 0.1s ease; white-space: nowrap;
    }
    .pf-dd__panel--sm .pf-dd__option { padding: 5px 8px; font-size: 12.5px; border-radius: 6px; }
    .pf-dd__option:hover:not(:disabled) { background: rgba(139, 92, 246, 0.07); }
    .pf-dd__option--active {
      background: rgba(139, 92, 246, 0.10); color: var(--color-primary, #7c3aed); font-weight: 600;
    }
    .pf-dd__option--active:hover:not(:disabled) { background: rgba(139, 92, 246, 0.14); }
    .pf-dd__option:disabled { opacity: 0.38; cursor: not-allowed; }
    .pf-dd__opt-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-dd__hint { flex-shrink: 0; font-size: 11px; color: var(--text-tertiary, #94a3b8); font-weight: 400; }

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

  @Output() valueChange = new EventEmitter<T>();

  readonly isOpen = signal(false);
  readonly panelPos = signal<PanelPos>({ top: 0, left: 0, width: 0, above: false });

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

  get matched(): boolean {
    if (this.value === null || this.value === undefined) return false;
    return this.allOptions.some(o => String(o.value) === String(this.value));
  }

  get displayLabel(): string {
    if (this.value === null || this.value === undefined) return this.placeholder;
    const opt = this.allOptions.find(o => String(o.value) === String(this.value));
    return opt?.label ?? this.placeholder;
  }

  isSelected(v: T): boolean {
    if (this.value === null || this.value === undefined) return false;
    return String(v) === String(this.value);
  }

  toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.disabled) return;
    if (!this.isOpen()) { this.openPanel(); } else { this.closePanel(); }
  }

  pick(opt: PfSelectOption<T>, ev: MouseEvent): void {
    ev.stopPropagation();
    if (opt.disabled) return;
    this.valueChange.emit(opt.value);
    this.closePanel();
  }

  private openPanel(): void {
    this.updatePanelPos();
    // Use TemplateRef.createEmbeddedView (not VCR) so no VCR re-anchors the node
    this.panelRef = this.panelTpl.createEmbeddedView(null as unknown as void);
    this.appRef.attachView(this.panelRef);
    this.panelRef.detectChanges();
    const panelEl = this.panelRef.rootNodes.find(
      (n: Node) => n.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement | undefined;
    if (panelEl) SelectComponent.getOverlayHost().appendChild(panelEl);
    this.isOpen.set(true);
  }

  private closePanel(): void {
    if (this.panelRef) {
      const panelEl = this.panelRef.rootNodes.find(
        (n: Node) => n.nodeType === Node.ELEMENT_NODE
      ) as HTMLElement | undefined;
      panelEl?.parentElement?.removeChild(panelEl);
      this.appRef.detachView(this.panelRef);
      this.panelRef.destroy();
      this.panelRef = undefined;
    }
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
    if (ev.key === 'Escape') {
      this.closePanel();
    } else if ((ev.key === 'Enter' || ev.key === ' ') && !this.isOpen()) {
      ev.preventDefault();
      if (!this.disabled) this.openPanel();
    }
  }

  @HostListener('window:scroll')
  onScroll(): void { if (this.isOpen()) this.closePanel(); }

  @HostListener('window:resize')
  onResize(): void { if (this.isOpen()) this.closePanel(); }
}
