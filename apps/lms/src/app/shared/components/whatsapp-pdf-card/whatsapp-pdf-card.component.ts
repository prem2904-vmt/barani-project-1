import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WhatsAppManualService, whatsAppBridge } from '../../../core/services/whatsapp-manual.service';

/**
 * WhatsApp Chat on the web / phones: the small "Report PDF" card that sits beside the chat
 * (the desktop app shows the same thing inside its docked panel — whatsapp-dock.component.ts).
 *
 * - A device that can share files (phones, some desktop browsers): **Share PDF** is the primary
 *   action — the file goes straight to WhatsApp through the share sheet, with the message.
 *   On a phone the chat with the report link is the secondary action.
 * - Otherwise: **Download PDF**, then attach it with WhatsApp's paperclip (a cross-origin chat
 *   can't be attached to — and nothing here ever automates WhatsApp).
 */
@Component({
  selector: 'pf-wa-pdf-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (card(); as c) {
      <aside class="pf-wpc" [class.pf-wpc--phone]="c.mode === 'phone'" role="region" aria-label="Report PDF" data-testid="wa-pdf-card">
        <div class="pf-wpc__head">
          <svg class="pf-wpc__ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>
          <div class="pf-wpc__titles">
            <span class="pf-wpc__title">Report PDF</span>
            <span class="pf-wpc__name pf-num">{{ c.name }}</span>
          </div>
          <button type="button" class="pf-wpc__x press" aria-label="Close" title="Close" (click)="svc.dismissPdfCard()" data-testid="wa-pdf-card-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <p class="pf-wpc__hint" data-testid="wa-pdf-card-hint">
          @if (c.canShare) {
            {{ c.mode === 'phone' ? 'Share the PDF to WhatsApp, pick the patient’s chat and press Send.' : 'Share the PDF to WhatsApp, or download it and attach it with the paperclip in the chat.' }}
          } @else {
            Download the PDF, then attach it with the paperclip in the WhatsApp chat and press Send.
          }
        </p>
        <div class="pf-wpc__acts">
          @if (c.canShare) {
            <button type="button" class="pf-btn pf-btn--primary pf-wpc__btn" (click)="svc.sharePdf()" data-testid="wa-pdf-share">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 15V3"/><path d="m8 7 4-4 4 4"/></svg>
              Share PDF
            </button>
            <button type="button" class="pf-btn pf-btn--secondary pf-wpc__btn" (click)="svc.downloadPdf()" data-testid="wa-pdf-download">Download PDF</button>
          } @else {
            <button type="button" class="pf-btn pf-btn--primary pf-wpc__btn" (click)="svc.downloadPdf()" data-testid="wa-pdf-download">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>
              Download PDF
            </button>
          }
          @if (c.chatUrl) {
            <button type="button" class="pf-btn pf-btn--tertiary pf-wpc__btn" (click)="svc.openChatFromCard()" data-testid="wa-pdf-chat">Open chat with the link</button>
          }
        </div>
      </aside>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-wpc {
      position: fixed; z-index: 40; bottom: 16px; right: 436px; width: min(320px, calc(100vw - 32px));
      display: flex; flex-direction: column; gap: 10px; padding: 14px;
      background: var(--bg-card-solid, #fff); color: var(--text-primary);
      border: 1px solid var(--pf-line); border-radius: var(--pf-radius-card, 14px);
      box-shadow: var(--pf-shadow-pop, 0 12px 32px rgba(0, 0, 0, 0.18));
    }
    .pf-wpc--phone { left: 16px; right: 16px; width: auto; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .pf-wpc__head { display: flex; align-items: center; gap: 10px; }
    .pf-wpc__ico { color: var(--text-secondary); flex: none; }
    .pf-wpc__titles { display: flex; flex-direction: column; min-width: 0; margin-right: auto; }
    .pf-wpc__title { font-size: 14px; font-weight: 600; }
    .pf-wpc__name { font-size: 12px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-wpc__x {
      width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; flex: none; margin: -8px -8px -8px 0;
      border: 0; border-radius: var(--pf-radius-sm, 10px); background: transparent; color: var(--text-secondary); cursor: pointer;
    }
    .pf-wpc__x:hover { background: var(--pf-chip-bg, rgba(127, 127, 127, 0.12)); color: var(--text-primary); }
    .pf-wpc__x:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 2px; }
    .pf-wpc__hint { margin: 0; font-size: 12.5px; line-height: 1.4; color: var(--text-secondary); }
    .pf-wpc__acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .pf-wpc__btn { min-height: 44px; display: inline-flex; align-items: center; gap: 8px; }
    .pf-wpc--phone .pf-wpc__btn { flex: 1 1 100%; justify-content: center; }
  `],
})
export class WhatsAppPdfCardComponent {
  protected readonly svc = inject(WhatsAppManualService);
  /** Hidden in the desktop app: its docked panel carries the PDF strip. */
  bridge = whatsAppBridge;
  protected readonly card = computed(() => (this.bridge() ? null : this.svc.pdfCard()));
}
