import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, output } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { isMac } from './desk';
import { SHORTCUTS, ShortcutRow } from './shortcuts';

/**
 * "Keyboard shortcuts" (press ?): the ONE table from shortcuts.ts, grouped,
 * with the keys as this computer names them (⌘ on a Mac, Ctrl elsewhere).
 */
@Component({
  selector: 'st-shortcuts',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ks-scrim" aria-hidden="true" (click)="closed.emit()"></div>
    <section class="ks" role="dialog" aria-modal="true" aria-labelledby="ks-h" tabindex="-1" (keydown.escape)="$event.preventDefault(); closed.emit()">
      <header class="ks-head">
        <span class="pf-card__icon"><pf-icon name="keyboard" [size]="16" /></span>
        <h2 class="ks-title" id="ks-h">Keyboard shortcuts</h2>
        <button type="button" class="pf-btn pf-btn--icon" aria-label="Close" (click)="closed.emit()"><pf-icon name="x" [size]="18" /></button>
      </header>
      <div class="ks-body">
        @for (g of groups; track g.title) {
          <section class="ks-grp">
            <h3 class="ks-grp__t">{{ g.title }}</h3>
            <dl class="ks-list">
              @for (r of g.rows; track r.command) {
                <div class="ks-row">
                  <dt>{{ r.words }}</dt>
                  <dd>
                    @for (combo of r.keys; track $index; let last = $last) {
                      <span class="ks-combo">
                        @for (k of combo; track $index) {
                          <kbd class="ks-key">{{ name(k) }}</kbd>
                        }
                      </span>
                      @if (!last) {
                        <span class="ks-or">or</span>
                      }
                    }
                  </dd>
                </div>
              }
            </dl>
          </section>
        }
      </div>
      <p class="ks-foot">Shortcuts wait while you type in a box; Esc leaves the box.</p>
    </section>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0 0 var(--pf-nav-h, 0px) 0;
        z-index: 70;
        display: grid;
        place-items: center;
        padding: 16px;
      }
      .ks-scrim {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.38);
      }
      .ks {
        position: relative;
        display: grid;
        gap: 10px;
        width: min(760px, 100%);
        max-height: 100%;
        padding: 14px 18px 16px;
        border: 1px solid var(--pf-line);
        border-radius: 18px;
        background: var(--pf-card-bg, var(--bg-primary));
        box-shadow: 0 30px 80px rgba(15, 23, 42, 0.3);
        animation: ks-in var(--pf-dur) var(--pf-spring) both;
        outline: none;
      }
      .ks-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .ks-title {
        flex: 1 1 auto;
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .ks-body {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 6px 28px;
      }
      .ks-grp__t {
        margin: 6px 0 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .ks-list {
        display: grid;
        margin: 0;
      }
      .ks-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 5px 0;
        border-bottom: 1px solid var(--border-muted, var(--pf-line));
        font-size: 13.5px;
      }
      .ks-row dd {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin: 0;
      }
      .ks-combo {
        display: inline-flex;
        gap: 3px;
      }
      .ks-key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 24px;
        padding: 0 7px;
        border: 1px solid var(--pf-line);
        border-bottom-width: 2px;
        border-radius: 6px;
        background: var(--pf-chip-bg);
        color: var(--text-primary);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .ks-or {
        font-size: 12px;
        color: var(--text-tertiary);
      }
      .ks-foot {
        margin: 2px 0 0;
        font-size: 12.5px;
        color: var(--text-tertiary);
      }
      @keyframes ks-in {
        from {
          opacity: 0;
          transform: scale(0.98);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .ks {
          animation: none;
        }
      }
    `,
  ],
})
export class ShortcutsPanelComponent {
  readonly closed = output<void>();
  private readonly mac = isMac();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly groups = (['Questions', 'Moving around', 'The form'] as ShortcutRow['group'][]).map((title) => ({
    title,
    rows: SHORTCUTS.filter((r) => r.group === title),
  }));

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.ks')?.focus());
  }

  protected name(k: string): string {
    if (k === 'mod') return this.mac ? '⌘' : 'Ctrl';
    if (this.mac && k === 'Alt') return '⌥';
    if (this.mac && k === 'Shift') return '⇧';
    return k;
  }
}
