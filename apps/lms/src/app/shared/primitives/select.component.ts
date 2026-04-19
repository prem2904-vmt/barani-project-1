import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, computed, inject, signal } from '@angular/core';

export interface PfSelectOption<T = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export type PfSelectSize = 'sm' | 'md';

/**
 * Themed custom select. Drop-in replacement for `<select>` with:
 *  - Theme tokens across the board (glass panel, violet active gradient).
 *  - Keyboard nav (↑/↓ to move, Enter to select, Esc to close, Tab to blur).
 *  - Spring-in dropdown, gradient accent pip, themed scrollbar.
 *  - `placeholder` shown when no value is set.
 */
@Component({
  selector: 'pf-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="root" [attr.data-size]="size" [attr.data-open]="_open() ? 'true' : 'false'">
      <button type="button"
              class="trigger"
              [disabled]="disabled"
              (click)="toggle()"
              (keydown)="onTriggerKey($event)"
              [attr.aria-haspopup]="'listbox'"
              [attr.aria-expanded]="_open()">
        <span class="trigger-label" [class.is-placeholder]="!selectedLabel()">
          {{ selectedLabel() ?? placeholder }}
        </span>
        <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      @if (_open()) {
        <div class="menu" role="listbox" #menu>
          <span class="accent" aria-hidden="true"></span>
          <ul>
            @for (opt of options; track opt.value; let i = $index) {
              <li role="option"
                  [attr.aria-selected]="isSelected(opt.value)"
                  [attr.data-active]="_highlight() === i ? 'true' : 'false'"
                  [attr.data-selected]="isSelected(opt.value) ? 'true' : 'false'"
                  [attr.data-disabled]="opt.disabled ? 'true' : 'false'"
                  (mouseenter)="_highlight.set(i)"
                  (mousedown)="$event.preventDefault(); select(opt)">
                <div class="opt-label">{{ opt.label }}</div>
                @if (opt.hint) { <div class="opt-hint">{{ opt.hint }}</div> }
                @if (isSelected(opt.value)) {
                  <svg class="check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m5 12 4 4L19 6"/>
                  </svg>
                }
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-block; width: 100%; }

    .root { position: relative; width: 100%; }

    .trigger {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      border-radius: 14px;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      text-align: left;
      font-size: 14px;
    }
    :host([data-size='sm']) .trigger,
    .root[data-size='sm'] .trigger { height: 36px; font-size: 13px; border-radius: 12px; padding: 0 12px; }
    .root[data-size='md'] .trigger { height: 44px; }

    .trigger:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }
    .trigger:focus-visible,
    .root[data-open='true'] .trigger {
      outline: none;
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.18);
    }
    .trigger:disabled { opacity: 0.5; cursor: not-allowed; }

    .trigger-label {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .trigger-label.is-placeholder { color: var(--text-muted); }

    .caret {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform 0.2s ease, color 0.15s ease;
    }
    .root[data-open='true'] .caret { transform: rotate(180deg); color: var(--text-primary); }

    .menu {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 8px);
      z-index: 50;
      max-height: 18rem;
      overflow-y: auto;
      border-radius: 16px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      animation: pf-sel-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .accent {
      position: absolute;
      top: 0;
      left: 12%;
      right: 12%;
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(168, 85, 247, 0.75) 50%, transparent 100%);
      pointer-events: none;
    }

    ul { list-style: none; margin: 0; padding: 6px; display: flex; flex-direction: column; gap: 2px; }

    li {
      position: relative;
      padding: 9px 30px 9px 12px;
      border-radius: 10px;
      font-size: 13.5px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    li[data-active='true'] {
      background: linear-gradient(90deg, rgba(124, 58, 237, 0.16), rgba(124, 58, 237, 0.04));
      color: var(--text-primary);
    }
    li[data-selected='true'] {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
    }
    li[data-selected='true'][data-active='true'] { filter: brightness(1.08); }
    li[data-disabled='true'] { opacity: 0.4; cursor: not-allowed; }

    .opt-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .opt-hint {
      font-size: 11px;
      margin-top: 2px;
      color: var(--text-muted);
    }
    li[data-selected='true'] .opt-hint { color: rgba(255, 255, 255, 0.8); }

    .check {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: #ffffff;
    }

    /* Scrollbar */
    .menu::-webkit-scrollbar { width: 8px; }
    .menu::-webkit-scrollbar-track { background: transparent; }
    .menu::-webkit-scrollbar-thumb { background: var(--glass-border); border-radius: 9999px; }
    .menu::-webkit-scrollbar-thumb:hover { background: var(--glass-border-hover); }

    @keyframes pf-sel-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
    @media (prefers-reduced-motion: reduce) { .menu { animation: none; } }
  `]
})
export class SelectComponent<T = unknown> {
  private readonly host = inject(ElementRef<HTMLElement>);

  @Input({ required: true }) options: PfSelectOption<T>[] = [];
  @Input() value!: T;
  @Input() placeholder = 'Select…';
  @Input() size: PfSelectSize = 'md';
  @Input() disabled = false;

  @Output() valueChange = new EventEmitter<T>();

  @ViewChild('menu') menuRef?: ElementRef<HTMLDivElement>;

  protected readonly _open = signal(false);
  protected readonly _highlight = signal<number>(-1);

  readonly selectedLabel = computed(() => {
    const match = this.options.find(o => o.value === this.value);
    return match ? match.label : null;
  });

  isSelected(v: T): boolean { return v === this.value; }

  toggle() {
    if (this.disabled) return;
    const next = !this._open();
    this._open.set(next);
    if (next) {
      const idx = this.options.findIndex(o => o.value === this.value);
      this._highlight.set(idx >= 0 ? idx : 0);
      queueMicrotask(() => this.scrollHighlightIntoView());
    }
  }

  close() { this._open.set(false); }

  select(opt: PfSelectOption<T>) {
    if (opt.disabled) return;
    this.value = opt.value;
    this.valueChange.emit(opt.value);
    this.close();
  }

  onTriggerKey(ev: KeyboardEvent) {
    if (this.disabled) return;

    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!this._open()) { this.toggle(); return; }
    }

    if (!this._open()) return;

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.moveHighlight(1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.moveHighlight(-1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const i = this._highlight();
      if (i >= 0 && i < this.options.length) this.select(this.options[i]);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    } else if (ev.key === 'Tab') {
      this.close();
    }
  }

  private moveHighlight(delta: number) {
    const n = this.options.length;
    if (!n) return;
    let i = this._highlight();
    // Skip disabled rows.
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!this.options[i].disabled) { this._highlight.set(i); this.scrollHighlightIntoView(); return; }
    }
  }

  private scrollHighlightIntoView() {
    const menu = this.menuRef?.nativeElement;
    if (!menu) return;
    const i = this._highlight();
    const row = menu.querySelector<HTMLElement>(`li:nth-child(${i + 1})`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this._open()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this.close();
  }
}
