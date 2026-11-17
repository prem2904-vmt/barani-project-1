import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { bridgeQrErrorText, parseBridgeQr } from '../../shared/bridges/bridge-qr';
import { openBridgeLink } from '../../shared/bridges/bridge-link';

/**
 * Public `/b` — where a phone camera lands when it scans a Bridge QR
 * (`https://lab.prefrontal.health/b#1.S.C.P.F`). Reads the FRAGMENT (never
 * sent to the server), hands it to the add screen through sessionStorage and
 * replaces this URL, so the secret leaves the address bar at once. Signed-out
 * users pass through login first (the add route's guard keeps the return URL).
 */
@Component({
  selector: 'pf-bridge-link-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="pf-blp">
      <section class="pf-card pf-blp__card" aria-live="polite">
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 17h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg></span>
          <h1 class="pf-card__label">Prefrontal Bridge</h1>
        </header>
        <div class="pf-card__body">
          @if (error()) {
            <p class="pf-blp__t">{{ error() }}</p>
            <p class="pf-blp__s">Open Lab settings → Bridges → Add Bridge in the Prefrontal app and type the claim code printed under the QR.</p>
          } @else {
            <p class="pf-blp__t">Opening Bridge setup…</p>
          }
        </div>
      </section>
    </main>
  `,
  styles: [`
    .pf-blp { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--bg-page, transparent); }
    .pf-blp__card { width: 100%; max-width: 28rem; }
    .pf-blp__t { margin: 0 0 6px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-blp__s { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
  `],
})
export class BridgeLinkPage implements OnInit {
  private readonly router = inject(Router);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.error.set(handleBridgeLinkHref(typeof window !== 'undefined' ? window.location.href : '', this.router));
  }
}

/**
 * The page's work, testable: parse the fragment, scrub it from the address
 * bar, hand it over. Returns the words to show when it isn't a Bridge link
 * (an unknown VERSION still goes through — the add screen says "Update the app").
 */
export function handleBridgeLinkHref(href: string, router: Router): string | null {
  const hashAt = href.indexOf('#');
  const fragment = hashAt >= 0 ? href.slice(hashAt) : '';
  const parsed = parseBridgeQr(fragment);
  try { if (hashAt >= 0) history.replaceState(history.state, '', href.slice(0, hashAt)); } catch { /* ignore */ }
  if (!parsed.ok && parsed.error !== 'unsupported_version') return bridgeQrErrorText(parsed.error);
  openBridgeLink(router, fragment);
  return null;
}
