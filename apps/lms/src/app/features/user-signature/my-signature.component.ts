import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { SignaturePadComponent } from '../../shared/components/signature-pad/signature-pad.component';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { signatureFileToPng } from '../../shared/utils/signature-image';

/**
 * "My signature" — a per-user digital signature the user draws once and reuses
 * everywhere they sign (invoices now; reports later). Stored server-side on the
 * user account (not localStorage, unlike Print settings) so it follows the user
 * to any station they log in at.
 */
@Component({
  selector: 'pf-my-signature',
  standalone: true,
  imports: [CommonModule, ScreenHeaderComponent, SignaturePadComponent],
  template: `
    <div class="mx-auto w-full max-w-2xl px-4 py-4">
      <pf-screen-header title="My signature"
        subtitle="Draw your signature — or upload a photo of it (we remove the paper background automatically). Saved to your account and printed wherever you sign (cash bills, reports).">
      </pf-screen-header>

      <div class="pf-sig-tile">
        <p class="pf-sig-eyebrow">Your signature</p>

        @if (uploadPreview(); as up) {
          <!-- Processed upload — confirm before it replaces the saved one. -->
          <div class="pf-sig-preview">
            <img [src]="up" alt="Processed signature" />
          </div>
          <p class="pf-sig-muted" style="margin-top: 8px;">Background removed. Use this signature?</p>
          <div class="pf-sig-row">
            <button type="button" class="pf-sig-cta pf-sig-cta--primary" style="margin-top: 0;" [disabled]="busy()" (click)="confirmUpload()">Use this signature</button>
            <button type="button" class="pf-sig-cta" (click)="uploadPreview.set(null)">Discard</button>
          </div>
        } @else if (current()) {
          <div class="pf-sig-preview">
            <img [src]="current()!" alt="Your signature" />
          </div>
          <div class="pf-sig-row">
            <button type="button" class="pf-sig-cta" (click)="pad.set(true)">Re-draw</button>
            <button type="button" class="pf-sig-cta" [disabled]="processing()" (click)="file.click()">
              {{ processing() ? 'Processing…' : 'Upload image' }}
            </button>
            <button type="button" class="pf-sig-cta pf-sig-cta--danger" [disabled]="busy()" (click)="remove()">Remove</button>
          </div>
        } @else {
          <div class="pf-sig-empty">
            <p>No signature yet.</p>
            <p class="pf-sig-muted">Draw one — or upload a photo/scan of your signature on paper and we'll cut the background out.</p>
          </div>
          <div class="pf-sig-row">
            <button type="button" class="pf-sig-cta pf-sig-cta--primary" style="margin-top: 0;" (click)="pad.set(true)">Draw signature</button>
            <button type="button" class="pf-sig-cta" [disabled]="processing()" (click)="file.click()">
              {{ processing() ? 'Processing…' : 'Upload image' }}
            </button>
          </div>
        }

        <input #file type="file" accept="image/png,image/jpeg,image/webp" class="hidden"
               (change)="onFileChosen($event)" />
      </div>
    </div>

    @if (pad()) {
      <pf-signature-pad [initialDataUrl]="current() ?? null"
        (saved)="onSaved($event)" (cancelled)="pad.set(false)"></pf-signature-pad>
    }
  `,
  styles: [`
    .pf-sig-tile { margin-top: 14px; padding: 18px; border-radius: 16px;
      background: var(--glass-bg, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border, rgba(148,163,184,0.16)); }
    .pf-sig-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      color: var(--text-tertiary, #94a3b8); margin-bottom: 10px; }
    .pf-sig-preview { background: #ffffff; border-radius: 12px; padding: 14px; display: flex; align-items: center;
      justify-content: center; min-height: 110px; border: 1px solid var(--glass-border, rgba(148,163,184,0.2)); }
    .pf-sig-preview img { max-width: 100%; max-height: 140px; object-fit: contain; }
    .pf-sig-empty { padding: 22px 6px 16px; }
    .pf-sig-empty p { margin: 0; font-size: 14px; color: var(--text-secondary, #cbd5e1); }
    .pf-sig-muted { color: var(--text-tertiary, #94a3b8) !important; font-size: 12.5px !important; margin-top: 4px !important; }
    .pf-sig-row { display: flex; gap: 10px; margin-top: 14px; }
    .pf-sig-cta { border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--glass-border, rgba(148,163,184,0.28)); background: transparent; color: var(--text-secondary, #cbd5e1); }
    .pf-sig-cta:hover:not(:disabled) { background: rgba(148,163,184,0.12); }
    .pf-sig-cta--primary { margin-top: 16px; background: var(--violet-600, #7c3aed); border-color: transparent; color: #fff; }
    .pf-sig-cta--danger { color: #f87171; border-color: rgba(248,113,113,0.4); }
    .pf-sig-cta:disabled { opacity: .5; cursor: default; }
  `],
})
export class MySignatureComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);

  readonly current = computed(() => this.auth.user()?.signatureDataUrl);
  readonly pad = signal(false);
  readonly busy = signal(false);
  /** Processed (background-removed) upload awaiting the user's confirmation. */
  readonly uploadPreview = signal<string | null>(null);
  readonly processing = signal(false);

  async onFileChosen(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file) return;
    this.processing.set(true);
    try {
      this.uploadPreview.set(await signatureFileToPng(file));
    } catch (e) {
      this.toasts.error((e as Error)?.message || 'Could not process that image.');
    } finally {
      this.processing.set(false);
    }
  }

  confirmUpload(): void {
    const url = this.uploadPreview();
    if (!url) return;
    this.uploadPreview.set(null);
    this.onSaved(url);
  }

  onSaved(dataUrl: string): void {
    this.busy.set(true);
    this.api.put<{ signatureDataUrl: string }>('/api/auth/me/signature', { dataUrl }).subscribe({
      next: r => { this.auth.setSignatureLocal(r.signatureDataUrl); this.busy.set(false); this.pad.set(false); this.toasts.success('Signature saved'); },
      error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }

  remove(): void {
    this.busy.set(true);
    this.api.delete('/api/auth/me/signature').subscribe({
      next: () => { this.auth.setSignatureLocal(null); this.busy.set(false); this.toasts.success('Signature removed'); },
      error: e => { this.busy.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
