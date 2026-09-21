import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { DesignModeService } from '../../../core/services/design-mode.service';

/**
 * The floating Design-mode badge (shell root). Shows the screen slug and the
 * live breakpoint so the designer names the Figma frame consistently
 * ("lab/my-work · Laptop 1280"), with one-tap copy. Collapses to a dot so it
 * never sits inside a capture — html.to.design grabs the whole visible DOM,
 * so the badge must get out of the way first.
 */
@Component({
  selector: 'pf-design-mode-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dm.minimized()) {
      <!-- Collapsed: a small dot that stays clear of captures. -->
      <button type="button" class="pf-dmb__dot press" (click)="dm.minimized.set(false)"
              aria-label="Design mode — expand badge">
        <span class="pf-dmb__pulse" aria-hidden="true"></span>
      </button>
    } @else {
      <div class="pf-dmb" role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 19l7-7 3 3-7 7-3-3z"/>
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
          <path d="M2 2l7.586 7.586"/>
          <circle cx="11" cy="11" r="2"/>
        </svg>
        <button type="button" class="pf-dmb__name press" (click)="copyFrameName()"
                [attr.aria-label]="'Copy frame name ' + frameName()">
          {{ frameName() }}
        </button>
        <span class="pf-dmb__bp">{{ breakpoint() }} · {{ width() }}px</span>
        @if (copied()) { <span class="pf-dmb__ok">Copied</span> }
        <button type="button" class="pf-dmb__btn press" (click)="dm.minimized.set(true)"
                aria-label="Minimise badge — keep design mode on">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
        </button>
        <button type="button" class="pf-dmb__btn press" (click)="dm.set(false)"
                aria-label="Exit design mode">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    }
  `,
  styles: [`
    .pf-dmb {
      position: fixed; left: 16px; bottom: 16px; z-index: 70;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 10px 7px 12px; border-radius: 999px;
      font-size: 12px; font-weight: 600;
      color: var(--text-primary);
      background: var(--glass-bg, rgba(20, 20, 28, 0.72));
      border: 1px solid rgba(168, 85, 247, 0.5);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
    }
    .pf-dmb > svg { color: var(--color-violet-400, #a78bfa); flex-shrink: 0; }
    .pf-dmb__name {
      background: none; border: 0; padding: 0; cursor: pointer;
      font: inherit; font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px; color: var(--text-primary);
      max-width: 40vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      text-decoration: underline dotted; text-underline-offset: 3px;
    }
    .pf-dmb__bp { font-size: 11px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-dmb__ok { font-size: 10.5px; font-weight: 700; color: var(--emerald-text, #10b981); }
    .pf-dmb__btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 999px; border: 0; cursor: pointer;
      background: rgba(255, 255, 255, 0.08); color: var(--text-secondary);
    }
    .pf-dmb__btn:hover { background: rgba(255, 255, 255, 0.16); color: var(--text-primary); }
    .pf-dmb__dot {
      position: fixed; left: 16px; bottom: 16px; z-index: 70;
      width: 14px; height: 14px; border-radius: 999px; border: 0; cursor: pointer;
      padding: 0; background: var(--color-violet-500, #7c3aed);
      box-shadow: 0 0 10px rgba(124, 58, 237, 0.65);
    }
    .pf-dmb__pulse { display: block; width: 100%; height: 100%; border-radius: inherit; }
  `]
})
export class DesignModeBadgeComponent {
  protected readonly dm = inject(DesignModeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly url = signal(this.norm(this.router.url));
  protected readonly width = signal(typeof window !== 'undefined' ? window.innerWidth : 0);
  protected readonly copied = signal(false);

  /** Route path without params — doubles as the Figma frame name. */
  protected readonly frameName = computed(() => this.url() || 'home');

  /** Breakpoint labels matching the Figma capture template convention. */
  protected readonly breakpoint = computed(() => {
    const w = this.width();
    return w < 640 ? 'Phone' : w < 1024 ? 'Tablet' : w < 1600 ? 'Laptop' : 'Wide';
  });

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(e => {
      if (e instanceof NavigationEnd) this.url.set(this.norm(e.urlAfterRedirects));
    });
    if (typeof window !== 'undefined') {
      const onResize = () => this.width.set(window.innerWidth);
      window.addEventListener('resize', onResize);
      this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
    }
  }

  protected copyFrameName(): void {
    const name = `${this.frameName()} · ${this.breakpoint()} ${this.width()}`;
    void navigator.clipboard?.writeText(name).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1200);
    });
  }

  private norm(u: string): string {
    return u.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
  }
}
