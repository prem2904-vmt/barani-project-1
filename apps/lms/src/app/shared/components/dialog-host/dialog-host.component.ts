import { ChangeDetectionStrategy, Component, HostListener, ViewChild, effect, ElementRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';
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
          <!-- Ambient glow leaking from the top — pulled in via pseudo-element,
               no visible stroke/line. -->
          <span class="pf-dh-glow" aria-hidden="true"></span>

          <header class="pf-dh-head">
            <span class="pf-dh-icon" aria-hidden="true">
              @if (d.tone === 'danger') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                  <path d="M12 9v4"/>
                  <path d="M12 17h.01"/>
                </svg>
              } @else if (d.kind === 'prompt') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              } @else {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4"/>
                  <path d="M12 8h.01"/>
                </svg>
              }
            </span>
            <div class="pf-dh-head-text">
              <h2 class="pf-dh-title">{{ d.title }}</h2>
              @if (d.message) {
                <p class="pf-dh-message">{{ d.message }}</p>
              }
            </div>
          </header>

          @if (d.kind === 'prompt') {
            <div class="pf-dh-input-wrap">
              @if (d.multiline) {
                <textarea #inputEl
                          class="pf-dh-field pf-dh-textarea"
                          [placeholder]="d.placeholder ?? ''"
                          [(ngModel)]="value"
                          (keydown.control.enter)="onConfirm()"
                          (keydown.meta.enter)="onConfirm()"
                          rows="3"></textarea>
              } @else {
                <input #inputEl
                       class="pf-dh-field pf-dh-input"
                       [type]="d.inputType ?? 'text'"
                       [placeholder]="d.placeholder ?? ''"
                       [(ngModel)]="value"
                       (keydown.enter)="onConfirm()" />
              }
            </div>
          }

          <footer class="pf-dh-actions">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="onCancel()">
              {{ d.cancelLabel ?? 'Cancel' }}
            </pf-touch-btn>
            <pf-touch-btn size="sm"
                          [variant]="d.tone === 'danger' ? 'danger' : 'primary'"
                          [disabled]="!canConfirm()"
                          (pressed)="onConfirm()">
              {{ d.confirmLabel ?? 'Confirm' }}
            </pf-touch-btn>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }

    /* ── Root + backdrop ───────────────────────────────────── */
    .pf-dh-root {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .pf-dh-backdrop {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(1200px 800px at 50% 100%, rgba(124, 58, 237, 0.15), transparent 60%),
        rgba(5, 5, 15, 0.72);
      backdrop-filter: blur(14px) saturate(1.2);
      -webkit-backdrop-filter: blur(14px) saturate(1.2);
      animation: pf-dh-fade 0.22s ease-out both;
    }

    /* ── Card ──────────────────────────────────────────────── */
    .pf-dh-card {
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
      animation: pf-dh-pop 0.3s cubic-bezier(0.2, 0.9, 0.25, 1.1) both;
    }
    .pf-dh-card[data-tone='danger'] {
      box-shadow:
        0 1px 0 0 rgba(255, 255, 255, 0.04) inset,
        0 30px 70px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(239, 68, 68, 0.12);
    }

    /* Soft gradient mist behind the icon — reads as premium, not decorated. */
    .pf-dh-glow {
      position: absolute;
      top: -80px;
      left: -40px;
      width: 260px;
      height: 200px;
      pointer-events: none;
      background:
        radial-gradient(closest-side, rgba(168, 85, 247, 0.35), transparent 70%);
      filter: blur(20px);
      opacity: 0.9;
    }
    .pf-dh-card[data-tone='danger'] .pf-dh-glow {
      background:
        radial-gradient(closest-side, rgba(239, 68, 68, 0.4), transparent 70%);
    }

    /* ── Header: icon + title stack left-aligned ───────────── */
    .pf-dh-head {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .pf-dh-icon {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(236, 72, 153, 0.12));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c4b5fd;
      box-shadow:
        0 6px 18px rgba(124, 58, 237, 0.25),
        0 0 0 4px rgba(124, 58, 237, 0.06);
    }
    .pf-dh-card[data-tone='danger'] .pf-dh-icon {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(239, 68, 68, 0.08));
      border-color: rgba(239, 68, 68, 0.35);
      color: #fca5a5;
      box-shadow:
        0 6px 18px rgba(239, 68, 68, 0.25),
        0 0 0 4px rgba(239, 68, 68, 0.06);
    }

    .pf-dh-head-text { flex: 1; min-width: 0; }

    .pf-dh-title {
      font-size: 16px;
      font-weight: 600;
      line-height: 1.35;
      letter-spacing: -0.011em;
      color: var(--text-primary);
      margin: 0;
    }
    .pf-dh-message {
      margin: 6px 0 0;
      font-size: 13.5px;
      line-height: 1.55;
      color: var(--text-secondary);
    }

    /* ── Input field ───────────────────────────────────────── */
    .pf-dh-input-wrap { margin-top: 18px; }

    .pf-dh-field {
      width: 100%;
      font: inherit;
      font-size: 14px;
      color: var(--text-primary);
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 10px 14px;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    .pf-dh-field::placeholder {
      color: var(--text-muted);
    }
    .pf-dh-field:hover:not(:disabled):not(:focus) {
      border-color: var(--glass-border-hover);
    }
    .pf-dh-field:focus {
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.15);
      background: var(--bg-card-solid);
    }
    .pf-dh-card[data-tone='danger'] .pf-dh-field:focus {
      border-color: rgba(239, 68, 68, 0.55);
      box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.15);
    }

    .pf-dh-textarea {
      min-height: 88px;
      max-height: 280px;
      resize: vertical;
      line-height: 1.5;
      font-family: inherit;
    }

    /* ── Footer actions ────────────────────────────────────── */
    .pf-dh-actions {
      margin-top: 22px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    @keyframes pf-dh-fade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes pf-dh-pop {
      from { opacity: 0; transform: translateY(10px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-dh-backdrop, .pf-dh-card { animation: none; }
    }

    @media (max-width: 480px) {
      .pf-dh-card { padding: 20px 18px 16px; border-radius: 18px; }
      .pf-dh-icon { width: 36px; height: 36px; border-radius: 10px; }
      .pf-dh-actions { flex-direction: column-reverse; }
      .pf-dh-actions pf-touch-btn { width: 100%; }
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
