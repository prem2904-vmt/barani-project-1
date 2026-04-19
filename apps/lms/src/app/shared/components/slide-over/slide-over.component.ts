import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

export type SlideOverWidth = 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'pf-slide-over',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="pf-so-root" role="dialog" aria-modal="true" [attr.aria-label]="title || 'Dialog'">
        <div class="pf-so-backdrop" (click)="onBackdrop()"></div>

        <aside class="pf-so-panel" [attr.data-width]="width">
          <!-- Ambient gradient stroke along the top edge. -->
          <span class="pf-so-accent" aria-hidden="true"></span>

          <header class="pf-so-header">
            <div class="min-w-0 flex-1">
              @if (eyebrow) {
                <p class="text-[11px] font-mono uppercase tracking-[0.18em] mb-1"
                   style="color: var(--text-muted);">{{ eyebrow }}</p>
              }
              <h2 class="text-[17px] font-semibold leading-tight truncate"
                  style="color: var(--text-primary);">{{ title }}</h2>
              @if (subtitle) {
                <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">{{ subtitle }}</p>
              }
            </div>
            <button type="button"
                    class="pf-so-close"
                    (click)="onClose()"
                    aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/>
                <path d="m6 6 12 12"/>
              </svg>
            </button>
          </header>

          <section class="pf-so-body">
            <ng-content></ng-content>
          </section>

          <footer class="pf-so-footer">
            <ng-content select="[footer]"></ng-content>
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    .pf-so-root {
      position: fixed;
      /* Dock beneath the sticky top strip so navigation stays accessible
         while the panel is open. */
      top: var(--pf-topbar-offset, 80px);
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 30;
      display: flex;
    }

    .pf-so-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(5, 5, 15, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      animation: pf-so-fade 0.22s ease-out both;
    }

    .pf-so-panel {
      position: relative;
      margin-left: auto;
      height: 100%;
      width: 100%;
      max-width: 32rem;
      background: var(--bg-card-solid);
      border-left: 1px solid var(--glass-border);
      box-shadow: -24px 0 80px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      animation: pf-so-slide 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both;

      /* Ambient violet glow leaking from the top-right corner. */
      background-image:
        radial-gradient(600px 320px at 100% 0%, rgba(124, 58, 237, 0.12), transparent 70%),
        radial-gradient(500px 280px at 100% 100%, rgba(236, 72, 153, 0.08), transparent 75%);
      background-color: var(--bg-card-solid);
    }

    .pf-so-panel[data-width='sm'] { max-width: 24rem; }
    .pf-so-panel[data-width='md'] { max-width: 32rem; }
    .pf-so-panel[data-width='lg'] { max-width: 44rem; }
    .pf-so-panel[data-width='xl'] { max-width: 56rem; }

    /* Thin gradient stroke along the very top edge of the panel. */
    .pf-so-accent {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(168, 85, 247, 0.7) 35%,
        rgba(236, 72, 153, 0.7) 65%,
        transparent 100%);
      pointer-events: none;
    }

    .pf-so-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 20px 22px 16px;
      border-bottom: 1px solid var(--border-muted);
      position: relative;
    }

    .pf-so-close {
      width: 36px;
      height: 36px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: var(--glass-bg);
      color: var(--text-secondary);
      border: 1px solid var(--glass-border);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, transform 0.08s ease, border-color 0.15s ease;
    }
    .pf-so-close:hover {
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .pf-so-close:active { transform: scale(0.94); }

    .pf-so-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 22px;
      position: relative;
    }

    /* Scrollbar styling so it doesn't break the glass feel. */
    .pf-so-body::-webkit-scrollbar { width: 8px; }
    .pf-so-body::-webkit-scrollbar-track { background: transparent; }
    .pf-so-body::-webkit-scrollbar-thumb {
      background: var(--glass-border);
      border-radius: 9999px;
    }
    .pf-so-body::-webkit-scrollbar-thumb:hover { background: var(--glass-border-hover); }

    .pf-so-footer {
      padding: 14px 22px;
      border-top: 1px solid var(--border-muted);
      background: var(--glass-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .pf-so-footer:empty { display: none; }

    @keyframes pf-so-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes pf-so-slide {
      from { transform: translateX(32px); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-so-backdrop, .pf-so-panel { animation: none; }
    }

    @media (max-width: 640px) {
      .pf-so-panel, .pf-so-panel[data-width] { max-width: 100%; }
    }
  `]
})
export class SlideOverComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() eyebrow?: string;
  @Input() subtitle?: string;
  @Input() width: SlideOverWidth = 'md';
  @Input() dismissOnBackdrop = true;

  @Output() closed = new EventEmitter<void>();

  onClose() { this.closed.emit(); }
  onBackdrop() { if (this.dismissOnBackdrop) this.closed.emit(); }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.open) this.closed.emit(); }
}
