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
          <span class="pf-cd-accent" aria-hidden="true"></span>

          <div class="pf-cd-icon">
            @if (tone === 'danger') {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <path d="M12 9v4"/>
                <path d="M12 17h.01"/>
              </svg>
            } @else {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              </svg>
            }
          </div>

          <h2 class="pf-cd-title">{{ title }}</h2>
          @if (message) {
            <p class="pf-cd-message">{{ message }}</p>
          }

          <div class="pf-cd-actions">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="cancel.emit()">{{ cancelLabel }}</pf-touch-btn>
            <pf-touch-btn size="sm"
                          [variant]="tone === 'danger' ? 'danger' : 'primary'"
                          (pressed)="confirm.emit()">{{ confirmLabel }}</pf-touch-btn>
          </div>
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
      padding: 16px;
    }

    .pf-cd-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(5, 5, 15, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: pf-cd-fade 0.2s ease-out both;
    }

    .pf-cd-card {
      position: relative;
      width: 100%;
      max-width: 26rem;
      padding: 28px 26px 22px;
      border-radius: 22px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
      text-align: center;
      overflow: hidden;
      animation: pf-cd-pop 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;

      /* Soft ambient glow bleeding from the top centered on the icon. */
      background-image:
        radial-gradient(320px 180px at 50% -10%, rgba(168, 85, 247, 0.18), transparent 70%);
      background-color: var(--bg-card-solid);
    }

    .pf-cd-card[data-tone='danger'] {
      background-image:
        radial-gradient(320px 180px at 50% -10%, rgba(239, 68, 68, 0.22), transparent 70%);
    }

    .pf-cd-accent {
      position: absolute;
      top: 0;
      left: 10%;
      right: 10%;
      height: 2px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(168, 85, 247, 0.85) 50%,
        transparent 100%);
      border-radius: 9999px;
      filter: blur(0.3px);
    }
    .pf-cd-card[data-tone='danger'] .pf-cd-accent {
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(239, 68, 68, 0.9) 50%,
        transparent 100%);
    }

    .pf-cd-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 16px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.25), rgba(168, 85, 247, 0.1));
      border: 1px solid rgba(168, 85, 247, 0.35);
      color: #c4b5fd;
      box-shadow: 0 8px 24px rgba(124, 58, 237, 0.25);
    }
    .pf-cd-card[data-tone='danger'] .pf-cd-icon {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.28), rgba(239, 68, 68, 0.1));
      border-color: rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
    }

    .pf-cd-title {
      font-size: 17px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .pf-cd-message {
      margin-top: 8px;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--text-secondary);
    }

    .pf-cd-actions {
      margin-top: 22px;
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    @keyframes pf-cd-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes pf-cd-pop {
      from { opacity: 0; transform: translateY(16px) scale(0.94); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-cd-backdrop, .pf-cd-card { animation: none; }
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
