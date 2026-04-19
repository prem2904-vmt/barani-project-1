import { ChangeDetectionStrategy, Component, HostListener, ViewChild, effect, ElementRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogService, DialogTone } from '../../../core/services/dialog.service';
import { TouchButtonComponent } from '../../primitives/touch-button.component';

@Component({
  selector: 'pf-dialog-host',
  standalone: true,
  imports: [FormsModule, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialog.active(); as d) {
      <div class="pf-dh-root" role="dialog" aria-modal="true" [attr.aria-label]="d.title">
        <div class="pf-dh-backdrop" (click)="onCancel()"></div>

        <div class="pf-dh-card" [attr.data-tone]="d.tone ?? 'primary'">
          <span class="pf-dh-accent" aria-hidden="true"></span>

          <div class="pf-dh-icon">
            @if (d.tone === 'danger') {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <path d="M12 9v4"/>
                <path d="M12 17h.01"/>
              </svg>
            } @else if (d.kind === 'prompt') {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            } @else {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              </svg>
            }
          </div>

          <h2 class="pf-dh-title">{{ d.title }}</h2>
          @if (d.message) {
            <p class="pf-dh-message">{{ d.message }}</p>
          }

          @if (d.kind === 'prompt') {
            <div class="pf-dh-input-wrap">
              @if (d.multiline) {
                <textarea #inputEl
                          class="pf-input pf-dh-textarea"
                          [placeholder]="d.placeholder ?? ''"
                          [(ngModel)]="value"
                          (keydown.control.enter)="onConfirm()"
                          (keydown.meta.enter)="onConfirm()"></textarea>
              } @else {
                <input #inputEl
                       class="pf-input pf-dh-input"
                       [type]="d.inputType ?? 'text'"
                       [placeholder]="d.placeholder ?? ''"
                       [(ngModel)]="value"
                       (keydown.enter)="onConfirm()" />
              }
            </div>
          }

          <div class="pf-dh-actions">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="onCancel()">
              {{ d.cancelLabel ?? 'Cancel' }}
            </pf-touch-btn>
            <pf-touch-btn size="sm"
                          [variant]="d.tone === 'danger' ? 'danger' : 'primary'"
                          [disabled]="!canConfirm()"
                          (pressed)="onConfirm()">
              {{ d.confirmLabel ?? 'Confirm' }}
            </pf-touch-btn>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    .pf-dh-root {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .pf-dh-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(5, 5, 15, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: pf-dh-fade 0.2s ease-out both;
    }

    .pf-dh-card {
      position: relative;
      width: 100%;
      max-width: 28rem;
      padding: 28px 26px 22px;
      border-radius: 22px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
      overflow: hidden;
      animation: pf-dh-pop 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;

      background-image:
        radial-gradient(320px 180px at 50% -10%, rgba(168, 85, 247, 0.18), transparent 70%);
      background-color: var(--bg-card-solid);
    }
    .pf-dh-card[data-tone='danger'] {
      background-image:
        radial-gradient(320px 180px at 50% -10%, rgba(239, 68, 68, 0.22), transparent 70%);
    }

    .pf-dh-accent {
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
    }
    .pf-dh-card[data-tone='danger'] .pf-dh-accent {
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(239, 68, 68, 0.9) 50%,
        transparent 100%);
    }

    .pf-dh-icon {
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
    .pf-dh-card[data-tone='danger'] .pf-dh-icon {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.28), rgba(239, 68, 68, 0.1));
      border-color: rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
    }

    .pf-dh-title {
      font-size: 17px;
      font-weight: 600;
      text-align: center;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .pf-dh-message {
      margin-top: 8px;
      font-size: 13.5px;
      line-height: 1.5;
      text-align: center;
      color: var(--text-secondary);
    }

    .pf-dh-input-wrap {
      margin-top: 18px;
    }
    .pf-dh-input { width: 100%; }
    .pf-dh-textarea { width: 100%; min-height: 96px; resize: vertical; }

    .pf-dh-actions {
      margin-top: 22px;
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    @keyframes pf-dh-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes pf-dh-pop {
      from { opacity: 0; transform: translateY(16px) scale(0.94); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-dh-backdrop, .pf-dh-card { animation: none; }
    }
  `]
})
export class DialogHostComponent {
  readonly dialog = inject(DialogService);

  @ViewChild('inputEl') inputEl?: ElementRef<HTMLInputElement | HTMLTextAreaElement>;

  readonly value = signal('');

  constructor() {
    // Reset field and focus the input when a prompt opens.
    effect(() => {
      const d = this.dialog.active();
      if (!d) { this.value.set(''); return; }
      this.value.set(d.initialValue ?? '');
      if (d.kind === 'prompt') {
        // Next frame so *ngIf / @if has rendered the input.
        queueMicrotask(() => setTimeout(() => this.inputEl?.nativeElement.focus(), 0));
      }
    });
  }

  canConfirm(): boolean {
    const d = this.dialog.active();
    if (!d || d.kind !== 'prompt') return true;
    if (!d.required) return true;
    return this.value().trim().length > 0;
  }

  onCancel() {
    const d = this.dialog.active();
    if (!d) return;
    this.dialog.resolve(d.kind === 'prompt' ? null : false);
  }

  onConfirm() {
    const d = this.dialog.active();
    if (!d) return;
    if (d.kind === 'prompt') {
      if (d.required && this.value().trim().length === 0) return;
      this.dialog.resolve(this.value());
    } else {
      this.dialog.resolve(true);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.dialog.active()) this.onCancel(); }
}
