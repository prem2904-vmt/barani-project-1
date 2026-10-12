import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { UpdaterService } from '../../../core/services/updater.service';

/**
 * Desktop self-update banner — mounted once in the shell (ShellComponent).
 * Small, non-blocking, bottom-anchored (the offline banner owns the top of
 * the viewport). Only ever appears once a download has finished and passed
 * sha512 verification ('ready'), or while a restart is waiting out a busy
 * analyzer connector ('deferred') — never while merely checking/downloading.
 *
 * ND pattern: primary (violet) ONLY on the actual call-to-action
 * ("Restart now"); "Later" is the quiet secondary. No native dialog.
 */
@Component({
  selector: 'pf-update-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updater.available && updater.bannerVisible()) {
      <div class="pf-update-banner" role="status">
        <div class="pf-update-banner__icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v6h-6" />
          </svg>
        </div>
        <div class="pf-update-banner__text">
          @if (deferred()) {
            <span class="pf-update-banner__title">Analyzer is connected</span>
            <span class="pf-update-banner__note">Restart after the current run?</span>
          } @else {
            <span class="pf-update-banner__title">Update{{ version() ? ' ' + version() : '' }} ready</span>
            <span class="pf-update-banner__note">Installs in the background on restart.</span>
          }
        </div>
        <div class="pf-update-banner__actions">
          <button type="button" class="pf-btn pf-btn--secondary" (click)="updater.dismiss()">Later</button>
          <button type="button" class="pf-btn pf-btn--primary" (click)="updater.restartNow()">Restart now</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pf-update-banner {
      position: fixed;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
      transform: translateX(-50%);
      z-index: 65; /* above toasts' stack area, below the offline banner */
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: calc(100vw - 32px);
      padding: 10px 14px;
      border-radius: var(--pf-radius, 12px);
      background: var(--pf-card-bg, #fff);
      border: 1px solid var(--pf-line, #e5e7eb);
      box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18);
    }
    .pf-update-banner__icon {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent);
      color: var(--color-primary, #7c3aed);
    }
    .pf-update-banner__text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .pf-update-banner__title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
    }
    .pf-update-banner__note {
      font-size: 12px;
      color: var(--text-tertiary);
      white-space: nowrap;
    }
    .pf-update-banner__actions {
      flex: none;
      display: flex;
      gap: 8px;
    }
    .pf-update-banner__actions .pf-btn {
      min-height: 32px;
      height: 32px;
      padding: 0 12px;
      font-size: 12.5px;
    }
    @media (max-width: 480px) {
      .pf-update-banner {
        left: 16px;
        right: 16px;
        transform: none;
        max-width: none;
        flex-wrap: wrap;
      }
      .pf-update-banner__actions { width: 100%; justify-content: flex-end; }
    }
  `],
})
export class UpdateBannerComponent {
  readonly updater = inject(UpdaterService);
  readonly version = computed(() => this.updater.state().version);
  readonly deferred = computed(() => this.updater.state().phase === 'deferred');
}
