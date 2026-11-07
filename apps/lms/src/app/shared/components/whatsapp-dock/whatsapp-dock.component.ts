import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { ElectronWhatsAppBridge, WaDockState, whatsAppBridge } from '../../../core/services/whatsapp-manual.service';

/** html class while the panel is docked (styles.scss reflows app-root). */
export const WA_DOCKED_CLASS = 'pf-wa-docked';

/**
 * Desktop app only: the strip ABOVE the docked WhatsApp Web panel (main
 * draws WhatsApp itself below it — electron/whatsapp-dock.js) and the app's
 * reflow to the left. Close, sign out, open the chat in the browser / the
 * WhatsApp app when it won't load here, and one quiet line about the report PDF
 * (copied by main to OUR clipboard: "press Ctrl+V in the chat"; or drag it).
 * Nothing here touches WhatsApp's page.
 */
@Component({
  selector: 'pf-wa-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (st(); as s) {
      @if (s.open) {
        <aside class="pf-wad" aria-label="WhatsApp" data-testid="wa-dock">
          <div class="pf-wad__bar">
            <svg class="pf-wad__mark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.5A8.4 8.4 0 1 1 21 11.5Z"/></svg>
            <span class="pf-wad__title">WhatsApp</span>
            <button type="button" class="pf-wad__icon press" title="Open in my browser" aria-label="Open in my browser" (click)="elsewhere('browser')">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>
            </button>
            <button type="button" class="pf-wad__icon press" title="Sign out of WhatsApp on this computer" aria-label="Sign out of WhatsApp on this computer" (click)="signOut()" data-testid="wa-dock-signout">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17 5 12l5-5"/><path d="M5 12h11"/></svg>
            </button>
            <button type="button" class="pf-wad__icon press" title="Close WhatsApp" aria-label="Close WhatsApp" (click)="close()" data-testid="wa-dock-close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div class="pf-wad__row" data-testid="wa-dock-card">
            @if (s.failed) {
              <span class="pf-wad__note">WhatsApp didn't load here.</span>
              <button type="button" class="pf-btn pf-btn--secondary pf-wad__small" (click)="elsewhere('browser')">Browser</button>
              <button type="button" class="pf-btn pf-btn--secondary pf-wad__small" (click)="elsewhere('app')">WhatsApp app</button>
            } @else if (s.pdfName && s.clipboard !== 'idle') {
              <!-- Our own header (not WhatsApp's page): where the PDF is. -->
              <span class="pf-wad__note" data-testid="wa-dock-line">{{ line(s) }}</span>
              <span class="pf-wad__pdf" draggable="true" (dragstart)="drag($event)" role="button" tabindex="0"
                    title="Or drag the PDF into the chat" aria-label="Drag the report PDF into the chat" data-testid="wa-dock-pdf">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>
              </span>
            } @else {
              <span class="pf-wad__note">{{ s.loading ? 'Opening the chat…' : 'Check the message, then press Send in WhatsApp.' }}</span>
            }
          </div>
          <p class="pf-wad__under">{{ s.failed ? "Open the same chat in your browser or the WhatsApp app." : 'Loading WhatsApp…' }}</p>
        </aside>
      }
    }
  `,
  styles: [`
    :host { display: contents; }
    /* app-root is transformed while docked, so "fixed" is relative to it:
       left: 100% puts the strip in the column right of the app. */
    .pf-wad {
      position: fixed; top: 0; left: 100%; bottom: 0; width: var(--pf-wa-dock-w, 380px);
      display: flex; flex-direction: column; z-index: 10;
      background: var(--bg-card-solid, #fff); color: var(--text-primary);
      border-left: 1px solid var(--pf-line);
    }
    .pf-wad__bar { display: flex; align-items: center; gap: 6px; padding: 0 8px 0 12px; height: 48px; flex: none; }
    .pf-wad__row { display: flex; align-items: center; gap: 6px; padding: 0 12px; height: 64px; flex: none; border-bottom: 1px solid var(--pf-line); }
    .pf-wad__mark { color: var(--text-secondary); flex: none; }
    .pf-wad__title { font-size: 14px; font-weight: 600; margin-right: auto; }
    .pf-wad__icon {
      width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; flex: none;
      border: 0; border-radius: var(--pf-radius-sm, 10px); background: transparent; color: var(--text-secondary); cursor: pointer;
    }
    .pf-wad__icon:hover { background: var(--pf-chip-bg, rgba(127, 127, 127, 0.12)); color: var(--text-primary); }
    .pf-wad__icon:focus-visible, .pf-wad__pdf:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 2px; }
    .pf-wad__pdf {
      display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: none; cursor: grab; user-select: none;
      border: 1px dashed var(--pf-sel-border, #9aa4ae); border-radius: var(--pf-radius-chip, 8px); color: var(--text-primary);
    }
    .pf-wad__pdf:active { cursor: grabbing; }
    .pf-wad__note { font-size: 12.5px; line-height: 1.35; color: var(--text-secondary); }
    .pf-wad__small { height: 36px; min-height: 34px; padding: 0 10px; font-size: 12.5px; }
    .pf-wad__under { margin: 24px 16px; font-size: 13px; color: var(--text-tertiary); text-align: center; }
  `],
})
export class WhatsAppDockComponent implements OnInit {
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  /** Specs pass a fake; the app reads window.electronAPI.whatsapp. */
  bridge: ElectronWhatsAppBridge | null = whatsAppBridge();
  doc: Document = document;

  readonly st = signal<WaDockState | null>(null);

  ngOnInit(): void {
    const b = this.bridge;
    if (!b) return;
    const off = b.onState((s) => this.apply(s));
    this.destroyRef.onDestroy(() => { off?.(); this.apply(null); });
    void b.state().then((s) => { if (s) this.apply(s); }).catch(() => { /* older desktop */ });
  }

  /** Follow main: reflow the app while the panel is open. */
  apply(s: WaDockState | null): void {
    this.st.set(s);
    const root = this.doc.documentElement;
    if (s?.open && s.width > 0) {
      root.classList.add(WA_DOCKED_CLASS);
      root.style.setProperty('--pf-wa-dock-w', `${Math.round(s.width)}px`);
    } else {
      root.classList.remove(WA_DOCKED_CLASS);
      root.style.removeProperty('--pf-wa-dock-w');
    }
  }

  close(): void { void this.bridge?.close(); }

  elsewhere(kind: 'browser' | 'app'): void { void this.bridge?.openElsewhere(kind); }

  async signOut(): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Sign out of WhatsApp on this computer?',
      message: 'WhatsApp closes here. Next time you will scan the QR code with your phone again.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (ok) await this.bridge?.signOut();
  }

  /** The one quiet line (our header). Copied → paste it; the copy failed → drag it. */
  line(s: WaDockState): string {
    if (s.clipboard === 'copied') return `Report PDF copied — press ${this.isMac() ? 'Cmd+V' : 'Ctrl+V'} in the chat to attach it, then Send.`;
    return 'Drag the report PDF into the chat to attach it, then Send.';
  }

  private isMac(): boolean {
    return /Mac|iPhone|iPad/i.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '');
  }

  /** The person drags the chip from OUR header: a native file drag (main.startDrag on the app's own window). */
  drag(ev: DragEvent): void {
    ev.preventDefault();
    this.bridge?.startDrag();
  }
}
