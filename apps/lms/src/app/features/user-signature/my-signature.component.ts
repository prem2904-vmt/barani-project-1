import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { SignaturePadComponent } from '../../shared/components/signature-pad/signature-pad.component';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { signatureFileToPng } from '../../shared/utils/signature-image';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../shared/primitives/segmented.component';
import { ThemeService } from '../../core/services/theme.service';
import { ActivatedRoute } from '@angular/router';
import { REGNO_PROMPT_TEXT } from '../../shared/components/regno-prompt/regno-prompt.component';
import { BusyDirective } from '../../shared/directives/busy.directive';
import { BusyComponent } from '../../shared/primitives/skeleton-kit.component';

type SigTab = 'signature' | 'registration';

/**
 * "My signature" — a per-user digital signature the user draws once and reuses
 * everywhere they sign (invoices now; reports later). Stored server-side on the
 * user account (not localStorage, unlike Print settings) so it follows the user
 * to any station they log in at.
 */
@Component({
  selector: 'pf-my-signature',
  standalone: true,
  imports: [BusyComponent, BusyDirective, CommonModule, ScreenHeaderComponent, SignaturePadComponent, HeroBandComponent, SegmentedComponent],
  template: `
    <!-- Hidden picker at the template root so the band's Upload action and
         the classic in-card buttons can both open it. -->
    <input #file type="file" accept="image/png,image/jpeg,image/webp" class="hidden"
           (change)="onFileChosen($event)" />

    <section class="pf-band-page mx-auto w-full max-w-2xl px-4 py-4">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): two real sections -> pill tabs; each tab's
             actions (Draw / Upload / Remove, or Save) ride on the band. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()"
                          (valueChange)="tab.set($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            @if (tab() === 'signature' && !uploadPreview()) {
              @if (current()) {
                <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="busy()" [pfBusy]="busyKind() === 'remove'" pfBusyLabel="Removing…" (click)="remove()"
                        aria-label="Remove" title="Remove signature"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Remove</button>
              }
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="processing()" [pfBusy]="processing()" pfBusyLabel="Processing…" (click)="file.click()"
                      aria-label="Upload image" title="Upload image"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M4 21h16"/></svg>{{ processing() ? 'Processing…' : 'Upload image' }}</button>
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="pad.set(true)"
                      [attr.aria-label]="current() ? 'Re-draw' : 'Draw signature'" [title]="current() ? 'Re-draw' : 'Draw signature'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>{{ current() ? 'Re-draw' : 'Draw signature' }}</button>
            } @else if (tab() === 'registration') {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press"
                      [disabled]="busy() || regId().trim() === savedRegId()" [pfBusy]="busyKind() === 'reg'" pfBusyLabel="Saving…" (click)="saveRegId()"
                      aria-label="Save" title="Save registration ID"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>Save</button>
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" title="My signature"
        subtitle="Draw your signature — or upload a photo of it (we remove the paper background automatically). Saved to your account and printed wherever you sign (cash bills, reports).">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-sig-col">
      @if (showSec('signature')) {
      <div class="pf-sig-tile">
        <p class="pf-sig-eyebrow">Your signature</p>
        @if (busyKind() === 'sig') {
          <!-- The new signature is on its way to your account. -->
          <p class="pf-sig-muted pf-sig-saving" role="status"><pf-busy label="Saving your signature…"></pf-busy> Saving your signature…</p>
        }

        @if (uploadPreview(); as up) {
          <!-- Processed upload — confirm before it replaces the saved one. -->
          <div class="pf-sig-preview">
            <img [src]="up" alt="Processed signature" />
          </div>
          <p class="pf-sig-muted" style="margin-top: 8px;">Background removed. Use this signature?</p>
          <div class="pf-sig-row">
            <button type="button" class="pf-sig-cta pf-sig-cta--primary" style="margin-top: 0;" [disabled]="busy()" [pfBusy]="busyKind() === 'sig'" pfBusyLabel="Saving…" (click)="confirmUpload()">Use this signature</button>
            <button type="button" class="pf-sig-cta" (click)="uploadPreview.set(null)">Discard</button>
          </div>
        } @else if (current()) {
          <div class="pf-sig-preview">
            <img [src]="current()!" alt="Your signature" />
          </div>
          <div class="pf-sig-row pf-classic-only">
            <button type="button" class="pf-sig-cta" (click)="pad.set(true)">Re-draw</button>
            <button type="button" class="pf-sig-cta" [disabled]="processing()" (click)="file.click()">
              {{ processing() ? 'Processing…' : 'Upload image' }}
            </button>
            <button type="button" class="pf-sig-cta pf-sig-cta--danger" [disabled]="busy()" [pfBusy]="busyKind() === 'remove'" pfBusyLabel="Removing…" (click)="remove()">Remove</button>
          </div>
        } @else {
          <div class="pf-sig-empty">
            <p>No signature yet.</p>
            <p class="pf-sig-muted">Draw one — or upload a photo/scan of your signature on paper and we'll cut the background out.</p>
          </div>
          <div class="pf-sig-row pf-classic-only">
            <button type="button" class="pf-sig-cta pf-sig-cta--primary" style="margin-top: 0;" (click)="pad.set(true)">Draw signature</button>
            <button type="button" class="pf-sig-cta" [disabled]="processing()" (click)="file.click()">
              {{ processing() ? 'Processing…' : 'Upload image' }}
            </button>
          </div>
        }
      </div>
      }

      <!-- Medical registration ID — shown beside your name on entry screens
           (dash until set) and printed under your signature on reports. -->
      @if (showSec('registration')) {
      <div class="pf-sig-tile">
        <p class="pf-sig-eyebrow">Registration ID</p>
        <p class="pf-sig-muted" style="margin-bottom: 10px;">
          Your medical council / registration number. Appears next to your name on
          lab screens and as "Reg. …" under your signature on reports.
        </p>
        @if (!savedRegId()) {
          <!-- Missing (the admin didn't add it): the user fills it here. -->
          <p class="pf-sig-regprompt" role="status">{{ regPrompt }}</p>
        }
        <div class="pf-sig-row" style="margin-top: 0;">
          <input type="text" class="nd-input nd-num pf-sig-input" maxlength="64" aria-label="Registration ID" placeholder="e.g. TN-12345"
                 [value]="regId()" (input)="regId.set($any($event.target).value)" />
          <button type="button" class="pf-sig-cta pf-sig-cta--primary pf-classic-only" style="margin-top: 0;"
                  [disabled]="busy() || regId().trim() === savedRegId()" [pfBusy]="busyKind() === 'reg'" pfBusyLabel="Saving…" (click)="saveRegId()">Save</button>
        </div>
      </div>
      }
      </div>
      </div>
    </section>

    @if (pad()) {
      <pf-signature-pad [initialDataUrl]="current() ?? null"
        (saved)="onSaved($event)" (cancelled)="pad.set(false)"></pf-signature-pad>
    }
  `,
  styles: [`
    :host-context(.design-new) .pf-sig-col { max-width: 42rem; margin-inline: auto; width: 100%; }
    :host-context(.design-new) .pf-sig-tile:first-child { margin-top: 0; }
    .pf-sig-tile { margin-top: 14px; padding: 18px; border-radius: var(--nd-radius-card, 16px);
      background: var(--nd-card-bg); border: 1px solid var(--nd-line); box-shadow: var(--nd-shadow-sm); }
    .pf-sig-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
      color: var(--text-tertiary, #94a3b8); margin-bottom: 10px; }
    .pf-sig-preview { background: #ffffff; border-radius: 12px; padding: 14px; display: flex; align-items: center;
      justify-content: center; min-height: 110px; border: 1px solid var(--nd-line); }
    .pf-sig-preview img { max-width: 100%; max-height: 140px; object-fit: contain; }
    .pf-sig-empty { padding: 22px 6px 16px; }
    .pf-sig-empty p { margin: 0; font-size: 14px; color: var(--text-secondary, #cbd5e1); }
    .pf-sig-muted { color: var(--text-tertiary, #94a3b8) !important; font-size: 12.5px !important; margin-top: 4px !important; }
    .pf-sig-saving { display: flex; align-items: center; gap: 8px; }
    .pf-sig-row { display: flex; gap: 10px; margin-top: 14px; }
    .pf-sig-cta { min-height: 44px; border-radius: var(--nd-radius-sm, 10px); padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
      border: 1px solid var(--nd-line); background: transparent; color: var(--text-secondary); }
    .pf-sig-cta:hover:not(:disabled) { background: var(--nd-chip-bg); }
    /* The kit primary (gradient) — the ONE in view when the band has none. */
    .pf-sig-cta--primary { margin-top: 16px; background: var(--gradient-primary, linear-gradient(90deg, #7c3aed, #c026d3)); border-color: transparent; color: #fff; }
    .pf-sig-cta--danger { color: var(--red-text, #b91c1c); border-color: rgba(248,113,113,0.4); }
    .pf-sig-cta:disabled { opacity: .5; cursor: default; }
    .pf-sig-input { flex: 1; }
    .pf-sig-regprompt { margin: 0 0 10px; font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
  `],
})
export class MySignatureComponent {
  protected readonly theme = inject(ThemeService);
  private readonly api = inject(ApiService);

  /** Band pill tabs (new design): signature vs registration ID. */
  readonly tabOptions: SegmentedOption<SigTab>[] = [
    { value: 'signature', label: 'Signature' },
    { value: 'registration', label: 'Registration ID' },
  ];
  /** ?tab=registration (the "Add your registration number" prompt links
   *  here) opens straight on the Registration ID section. */
  private readonly route = inject(ActivatedRoute, { optional: true });
  readonly tab = signal<SigTab>(
    this.route?.snapshot?.queryParamMap?.get('tab') === 'registration' ? 'registration' : 'signature');
  readonly regPrompt = REGNO_PROMPT_TEXT;
  /** Classic shows both sections; the new design shows the pill's tab. */
  showSec(k: SigTab): boolean { return !this.theme.isNewDesign() || this.tab() === k; }
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);

  readonly current = computed(() => this.auth.user()?.signatureDataUrl);
  readonly pad = signal(false);
  readonly busy = signal(false);
  /** Which request is running (its button / the tile shows it). */
  readonly busyKind = signal<'reg' | 'sig' | 'remove' | null>(null);
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

  /** Medical registration ID (shown as "Reg: …" on entry screens + reports). */
  readonly savedRegId = computed(() => this.auth.user()?.registrationId?.trim() ?? '');
  readonly regId = signal('');
  private readonly _regSeed = effect(() => this.regId.set(this.savedRegId()));

  saveRegId(): void {
    const value = this.regId().trim();
    this.busy.set(true);
    this.busyKind.set('reg');
    this.api.put<{ registrationId: string | null }>('/api/auth/me/registration-id', { registrationId: value }).subscribe({
      next: r => {
        this.auth.setRegistrationIdLocal(r.registrationId ?? null);
        this.busy.set(false);
        this.busyKind.set(null);
        this.toasts.success(value ? 'Registration ID saved' : 'Registration ID cleared');
      },
      error: e => { this.busy.set(false); this.busyKind.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }

  onSaved(dataUrl: string): void {
    this.busy.set(true);
    this.busyKind.set('sig');
    this.api.put<{ signatureDataUrl: string }>('/api/auth/me/signature', { dataUrl }).subscribe({
      next: r => { this.auth.setSignatureLocal(r.signatureDataUrl); this.busy.set(false); this.busyKind.set(null); this.pad.set(false); this.toasts.success('Signature saved'); },
      error: e => { this.busy.set(false); this.busyKind.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }

  remove(): void {
    this.busy.set(true);
    this.busyKind.set('remove');
    this.api.delete('/api/auth/me/signature').subscribe({
      next: () => { this.auth.setSignatureLocal(null); this.busy.set(false); this.busyKind.set(null); this.toasts.success('Signature removed'); },
      error: e => { this.busy.set(false); this.busyKind.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
