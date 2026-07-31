import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { TouchButtonComponent } from '../../primitives/touch-button.component';

export type ConfirmTone = 'primary' | 'danger';

@Component({
  selector: 'pf-confirm-dialog',
  standalone: true,
  imports: [TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div class="pf-cd-root" role="dialog" aria-modal="true" [attr.aria-label]="title">
        <div class="pf-cd-backdrop" (click)="cancel.emit()"></div>

        <div class="pf-cd-card" [attr.data-tone]="tone">
          <span class="pf-cd-glow" aria-hidden="true"></span>

          <header class="pf-cd-head">
            <span class="pf-cd-icon" aria-hidden="true">
              @if (tone === 'danger') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                  <path d="M12 9v4"/>
                  <path d="M12 17h.01"/>
                </svg>
              } @else {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4"/>
                  <path d="M12 8h.01"/>
                </svg>
              }
            </span>
            <div class="pf-cd-head-text">
              <h2 class="pf-cd-title">{{ title }}</h2>
              @if (message) { <p class="pf-cd-message">{{ message }}</p> }
            </div>
          </header>

          <footer class="pf-cd-actions">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="cancel.emit()">{{ cancelLabel }}</pf-touch-btn>
            <pf-touch-btn size="sm"
                          [variant]="tone === 'danger' ? 'danger' : 'primary'"
                          (pressed)="confirm.emit()">{{ confirmLabel }}</pf-touch-btn>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    .pf-cd-root {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .pf-cd-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.72);
      backdrop-filter: blur(14px) saturate(1.2);
      -webkit-backdrop-filter: blur(14px) saturate(1.2);
      animation: pf-cd-fade 0.22s ease-out both;
    }

    .pf-cd-card {
      position: relative;
      width: 100%;
      max-width: 26rem;
      padding: 24px 24px 20px;
      border-radius: 20px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow:
        0 1px 0 0 rgba(255, 255, 255, 0.04) inset,
        0 30px 70px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(168, 85, 247, 0.08);
      overflow: hidden;
      animation: pf-cd-pop 0.3s cubic-bezier(0.2, 0.9, 0.25, 1.1) both;
    }
    .pf-cd-card[data-tone='danger'] {
      box-shadow:
        0 1px 0 0 rgba(255, 255, 255, 0.04) inset,
        0 30px 70px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(239, 68, 68, 0.12);
    }

    .pf-cd-glow {
      position: absolute;
      top: -80px;
      left: -40px;
      width: 260px;
      height: 200px;
      pointer-events: none;
      background: radial-gradient(closest-side, rgba(168, 85, 247, 0.35), transparent 70%);
      filter: blur(20px);
      opacity: 0.9;
    }
    .pf-cd-card[data-tone='danger'] .pf-cd-glow {
      background: radial-gradient(closest-side, rgba(239, 68, 68, 0.4), transparent 70%);
    }

    .pf-cd-head {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }
    .pf-cd-icon {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(236, 72, 153, 0.12));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: var(--violet-text);
      box-shadow:
        0 6px 18px rgba(124, 58, 237, 0.25),
        0 0 0 4px rgba(124, 58, 237, 0.06);
    }
    .pf-cd-card[data-tone='danger'] .pf-cd-icon {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(239, 68, 68, 0.08));
      border-color: rgba(239, 68, 68, 0.35);
      color: var(--red-text);
      box-shadow:
        0 6px 18px rgba(239, 68, 68, 0.25),
        0 0 0 4px rgba(239, 68, 68, 0.06);
    }

    .pf-cd-head-text { flex: 1; min-width: 0; }
    .pf-cd-title {
      font-size: 16px;
      font-weight: 600;
      line-height: 1.35;
      letter-spacing: -0.011em;
      color: var(--text-primary);
      margin: 0;
    }
    .pf-cd-message {
      margin: 6px 0 0;
      font-size: 13.5px;
      line-height: 1.55;
      color: var(--text-secondary);
    }

    .pf-cd-actions {
      margin-top: 22px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    @keyframes pf-cd-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes pf-cd-pop {
      from { opacity: 0; transform: translateY(10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-cd-backdrop, .pf-cd-card { animation: none; }
    }
    @media (max-width: 480px) {
      .pf-cd-card { padding: 20px 18px 16px; border-radius: 18px; }
      .pf-cd-icon { width: 36px; height: 36px; border-radius: 10px; }
      .pf-cd-actions { flex-direction: column-reverse; }
      .pf-cd-actions pf-touch-btn { width: 100%; }
    }
  `]
})
export class ConfirmDialogComponent {
  @Input() open = false;
  @Input() title = 'Confirm';
  @Input() message = '';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() danger = false;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  get tone(): ConfirmTone { return this.danger ? 'danger' : 'primary'; }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.open) this.cancel.emit(); }

  @HostListener('document:keydown.enter')
  onEnter() { if (this.open) this.confirm.emit(); }
}
