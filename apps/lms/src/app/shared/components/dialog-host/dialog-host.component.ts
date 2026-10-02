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
              @if (d.icon === 'printer') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 9V3h12v6"/>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <path d="M6 14h12v7H6z"/>
                </svg>
              } @else if (d.tone === 'danger') {
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

          @if (d.items?.length) {
            <ul class="pf-dh-items">
              @for (it of d.items; track $index) { <li class="pf-dh-item">{{ it }}</li> }
            </ul>
          }
          @if (d.question) {
            <p class="pf-dh-question">{{ d.question }}</p>
          }

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

          @if (d.kind === 'choice') {
            <div class="pf-dh-choices" role="radiogroup" [attr.aria-label]="d.title">
              @for (c of d.choices ?? []; track c.value) {
                <button type="button" role="radio" class="pf-dh-choice"
                        [class.is-on]="choice() === c.value"
                        [attr.aria-checked]="choice() === c.value"
                        [attr.data-choice]="c.value"
                        (click)="choice.set(c.value)"
                        (dblclick)="choice.set(c.value); onConfirm()"
                        (keydown.enter)="$event.preventDefault(); choice.set(c.value); onConfirm()">
                  <span class="pf-dh-radio" aria-hidden="true"></span>
                  <span class="pf-dh-choice-text">
                    <span class="pf-dh-choice-label">{{ c.label }}</span>
                    @if (c.hint) { <span class="pf-dh-choice-hint">{{ c.hint }}</span> }
                  </span>
                </button>
              }
            </div>
          }

          @if (d.kind === 'actions' && d.checkbox) {
            <button type="button" role="checkbox" class="pf-dh-check"
                    [class.is-on]="checked()" [attr.aria-checked]="checked()"
                    (click)="checked.set(!checked())">
              <span class="pf-dh-check-box" aria-hidden="true">
                @if (checked()) {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                }
              </span>
              <span class="pf-dh-check-label">{{ d.checkbox.label }}</span>
            </button>
          }

          @if (d.kind === 'actions') {
            <footer class="pf-dh-actions pf-dh-actions--many">
              <pf-touch-btn size="sm" variant="ghost" (pressed)="onCancel()">
                {{ d.cancelLabel ?? 'Cancel' }}
              </pf-touch-btn>
              @for (a of d.actions ?? []; track a.value) {
                <pf-touch-btn size="sm" [attr.data-action]="a.value"
                              [variant]="a.variant === 'primary' ? 'primary' : 'secondary'"
                              (pressed)="onAction(a.value)">
                  {{ a.label }}
                </pf-touch-btn>
              }
            </footer>
          } @else {
          <footer class="pf-dh-actions" [class.pf-dh-actions--single]="d.singleButton">
            @if (!d.singleButton) {
              <pf-touch-btn size="sm" variant="ghost" (pressed)="onCancel()">
                {{ d.cancelLabel ?? 'Cancel' }}
              </pf-touch-btn>
            }
            <pf-touch-btn size="sm"
                          [variant]="d.tone === 'danger' ? 'danger' : 'primary'"
                          [disabled]="!canConfirm()"
                          (pressed)="onConfirm()">
              {{ d.confirmLabel ?? 'Confirm' }}
            </pf-touch-btn>
          </footer>
          }
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
      color: var(--violet-text);
      box-shadow:
        0 6px 18px rgba(124, 58, 237, 0.25),
        0 0 0 4px rgba(124, 58, 237, 0.06);
    }
    .pf-dh-card[data-tone='danger'] .pf-dh-icon {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(239, 68, 68, 0.08));
      border-color: rgba(239, 68, 68, 0.35);
      color: var(--red-text);
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

    /* ── Optional list + closing question ───────────────────── */
    .pf-dh-items {
      position: relative;
      margin: 14px 0 0;
      padding: 8px 12px;
      list-style: none;
      max-height: 40vh;
      overflow-y: auto;
      overscroll-behavior: contain;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-dh-item {
      font-size: 13px;
      line-height: 1.45;
      color: var(--text-primary);
      overflow-wrap: anywhere;
    }
    .pf-dh-question {
      position: relative;
      margin: 14px 0 0;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
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

    /* ── Choice cards (choose()) ─────────────────────────────── */
    .pf-dh-choices {
      position: relative;
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pf-dh-choice {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
      min-height: 44px;
      padding: 12px 14px;
      text-align: left;
      font: inherit;
      color: var(--text-primary);
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    }
    .pf-dh-choice:hover:not(.is-on) { border-color: var(--glass-border-hover); }
    .pf-dh-choice:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.25); }
    .pf-dh-choice.is-on {
      border-color: rgba(168, 85, 247, 0.55);
      background: var(--bg-card-solid);
      box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.25);
    }
    .pf-dh-radio {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      border-radius: 50%;
      border: 1.5px solid var(--text-tertiary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .pf-dh-choice.is-on .pf-dh-radio { border-color: var(--violet-text); }
    .pf-dh-choice.is-on .pf-dh-radio::after {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--violet-text);
    }
    .pf-dh-choice-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-dh-choice-label { font-size: 14px; font-weight: 600; line-height: 1.35; }
    .pf-dh-choice-hint { font-size: 12.5px; line-height: 1.45; color: var(--text-secondary); }

    /* ── Footer actions ────────────────────────────────────── */
    .pf-dh-actions {
      margin-top: 22px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    /* One button only (alert()) — nothing to decide, so nothing to weigh it
       against; it sits where the primary action normally does. */
    .pf-dh-actions--single { justify-content: flex-end; }

    /* Many actions (actions()): a full-width stack, the CTA on top, Cancel
       last — reads cleanly at every width instead of a ragged wrap. */
    .pf-dh-actions--many { flex-direction: column-reverse; align-items: stretch; margin-top: 18px; }
    .pf-dh-actions--many pf-touch-btn { display: block; width: 100%; }

    /* ── Checkbox (actions()) — 44px tap row, SVG tick, no native input ── */
    .pf-dh-check {
      position: relative;
      margin-top: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 44px;
      padding: 0 2px;
      text-align: left;
      font: inherit;
      font-size: 13.5px;
      color: var(--text-secondary);
      background: none;
      border: 0;
      cursor: pointer;
    }
    .pf-dh-check:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.25); border-radius: 10px; }
    .pf-dh-check-box {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: 1.5px solid var(--text-tertiary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pf-dh-check.is-on { color: var(--text-primary); }
    .pf-dh-check.is-on .pf-dh-check-box { background: var(--violet-text); border-color: var(--violet-text); }

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

        /* Phone: 16px stops the iOS focus-zoom every prompt dialog triggered;
       the card scrolls within the viewport so the keyboard can never push the
       confirm button out of reach. Desktop untouched. */
    @media (max-width: 640px) {
      .pf-dh-field { font-size: 16px; }
      .pf-dh-root { overflow-y: auto; }
      .pf-dh-card { max-height: calc(100dvh - 40px); overflow-y: auto; }
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @ViewChild('inputEl') inputEl?: ElementRef<HTMLInputElement | HTMLTextAreaElement>;

  readonly value = signal('');
  /** Selected option of a choice dialog. */
  readonly choice = signal<string | null>(null);
  /** Checkbox state of an actions() dialog. */
  readonly checked = signal(false);

  constructor() {
    // Reset field and focus the input when a prompt opens.
    effect(() => {
      const d = this.dialog.active();
      if (!d) { this.value.set(''); return; }
      this.value.set(d.initialValue ?? '');
      this.choice.set(d.kind === 'choice' ? (d.initialChoice ?? d.choices?.[0]?.value ?? null) : null);
      this.checked.set(!!d.checkbox?.initial);
      if (d.kind === 'prompt') {
        queueMicrotask(() => setTimeout(() => this.inputEl?.nativeElement.focus(), 0));
      }
      if (d.kind === 'choice') {
        // Focus the pre-selected card so Enter prints the default at once.
        queueMicrotask(() => setTimeout(() =>
          (this.host.nativeElement.querySelector('.pf-dh-choice.is-on') as HTMLElement | null)?.focus(), 0));
      }
    });
  }

  canConfirm(): boolean {
    const d = this.dialog.active();
    if (d?.kind === 'choice') return this.choice() !== null;
    if (!d || d.kind !== 'prompt') return true;
    if (!d.required) return true;
    return this.value().trim().length > 0;
  }

  onCancel() {
    const d = this.dialog.active();
    if (!d) return;
    this.dialog.resolve(d.kind === 'confirm' ? false : null, d.kind === 'actions' ? this.checked() : undefined);
  }

  /** A footer action of an actions() dialog. */
  onAction(value: string) {
    if (!this.dialog.active()) return;
    this.dialog.resolve(value, this.checked());
  }

  onConfirm() {
    const d = this.dialog.active();
    if (!d) return;
    if (d.kind === 'prompt') {
      if (d.required && this.value().trim().length === 0) return;
      this.dialog.resolve(this.value());
    } else if (d.kind === 'choice') {
      const c = this.choice();
      if (c !== null) this.dialog.resolve(c);
    } else {
      this.dialog.resolve(true);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.dialog.active()) this.onCancel(); }
}
