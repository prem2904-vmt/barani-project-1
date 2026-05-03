import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener,
  OnInit, computed, inject, signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';

/**
 * V2 — flat row designed to live inside the shared .pf-chrome card
 * in ShellComponent. The card provides border-radius, background, and
 * backdrop-blur; this component is a plain flex row with no decoration
 * of its own, matching the top-strip row above it.
 */
@Component({
  selector: 'pf-tenant-strip-v2',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tenantLoaded()) {
      <div class="pf-nb-bar">

        <!-- Left: tenant branding -->
        <a routerLink="/setup" class="pf-nb__brand press"
           [class.pf-nb__brand--empty]="!hasBrand()"
           [attr.aria-label]="hasBrand() ? (tenantName() + ' — branding settings') : 'Set up branding'">
          @if (showLogo() && tenantLogo()) {
            <img [src]="tenantLogo()!" [alt]="tenantName()" class="pf-nb__logo" />
          } @else {
            <span class="pf-nb__icon" aria-hidden="true">{{ tenantInitial() }}</span>
          }
          @if (showName()) {
            <span class="pf-nb__name">{{ tenantName() || brandingName()  }}</span>
          }
        </a>

        <div class="flex-1 min-w-0"></div>

        <!-- Right: branch selector -->
        <div class="relative flex-shrink-0">
          <button type="button" class="pf-nb__branch press"
                  [class.pf-nb__branch--open]="branchOpen()"
                  [attr.aria-expanded]="branchOpen()"
                  [attr.aria-label]="'Switch branch — currently ' + branch()"
                  (click)="toggleBranch()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 21s-7-4.5-7-12a7 7 0 0 1 14 0c0 7.5-7 12-7 12Z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
            <span class="pf-nb__branch-eyebrow">Branch</span>
            <span class="pf-nb__branch-name">{{ branch() }}</span>
            <svg class="pf-nb__chev" width="10" height="10" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          @if (branchOpen()) {
            <div class="pf-nb__pop" role="menu">
              <div class="pf-nb__pop-head">
                <p class="pf-nb__pop-eyebrow">Active branch</p>
                <p class="pf-nb__pop-current">{{ branch() }}</p>
              </div>
              <div class="pf-nb__pop-divider"></div>
              @for (b of branches; track b) {
                <button type="button" class="pf-nb__pop-item"
                        [class.pf-nb__pop-item--active]="b === branch()"
                        (click)="selectBranch(b)"
                        role="menuitem">
                  <span class="truncate">{{ b }}</span>
                  @if (b === branch()) {
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 12 4 4L19 6"/>
                    </svg>
                  }
                </button>
              }
            </div>
          }
        </div>

      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    /* Flat row — border-radius, background, and backdrop-blur are
     * provided by the outer .pf-chrome card in ShellComponent.
     * This component only defines layout and content styling. */
    .pf-nb-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 64px;
      padding: 10px 16px 10px 12px;
    }
    @media (max-width: 639px) {
      .pf-nb-bar { min-height: 58px; padding: 8px 10px; gap: 4px; }
    }

    /* ── Brand (left) ── */
    .pf-nb__brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 4px 10px 4px 4px;
      border-radius: 9999px;
      text-decoration: none;
      color: var(--text-primary);
      flex-shrink: 0;
      transition: background 0.15s ease, opacity 0.15s ease;
    }
    .pf-nb__brand:hover { background: var(--bg-hover); opacity: 0.96; }
    .pf-nb__brand--empty { color: #ec4899; }

    .pf-nb__logo {
      height: 40px;
      max-width: 200px;
      object-fit: contain;
      flex-shrink: 0;
    }
    @media (max-width: 639px) {
      .pf-nb__logo { height: 30px; max-width: 140px; }
    }

    .pf-nb__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: var(--gradient-primary);
      color: #fff;
      font-size: 18px;
      font-weight: 700;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
    }
    @media (max-width: 639px) {
      .pf-nb__icon { width: 34px; height: 34px; font-size: 15px; border-radius: 9px; }
    }

    .pf-nb__name {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.012em;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 60vw;
    }
    @media (max-width: 639px) {
      .pf-nb__name { font-size: 15px; max-width: 50vw; }
    }

    /* ── Branch selector (right) ── */
    .pf-nb__branch {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 2rem;
      padding: 0 8px 0 10px;
      border-radius: 9999px;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-nb__branch:hover,
    .pf-nb__branch--open { background: var(--bg-hover); color: var(--text-primary); }

    .pf-nb__branch svg:first-child { color: #a855f7; flex-shrink: 0; }

    .pf-nb__branch-eyebrow {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
    }
    @media (max-width: 639px) {
      .pf-nb__branch-eyebrow { display: none; }
    }

    .pf-nb__branch-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      max-width: 130px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pf-nb__branch:hover .pf-nb__branch-name,
    .pf-nb__branch--open .pf-nb__branch-name { color: var(--text-primary); }

    .pf-nb__chev {
      color: var(--text-muted);
      flex-shrink: 0;
      transition: transform 0.2s ease, color 0.2s ease;
    }
    .pf-nb__branch--open .pf-nb__chev {
      transform: rotate(180deg);
      color: var(--text-primary);
    }

    /* ── Branch popover ── */
    .pf-nb__pop {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      min-width: 240px;
      padding: 6px;
      border-radius: 18px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      z-index: 50;
      overflow: hidden;
      animation: pf-nb-pop 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    @keyframes pf-nb-pop {
      from { opacity: 0; transform: translateY(-6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .pf-nb__pop-head { padding: 10px 12px 6px; }
    .pf-nb__pop-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      margin: 0;
    }
    .pf-nb__pop-current {
      margin: 4px 0 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-nb__pop-divider {
      height: 1px;
      margin: 4px 8px;
      background: var(--border-muted);
    }
    .pf-nb__pop-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 9px 12px;
      border-radius: 10px;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      text-align: left;
    }
    .pf-nb__pop-item:hover { background: var(--bg-hover); color: var(--text-primary); }
    .pf-nb__pop-item--active { background: var(--gradient-primary); color: #fff; }
    .pf-nb__pop-item--active:hover { background: var(--gradient-primary); color: #fff; }
  `]
})
export class TenantStripV2Component implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly branches = ['Chennai Main', 'Anna Nagar', 'T. Nagar', 'OMR'];
  protected readonly branch = signal<string>('Chennai Main');
  protected readonly branchOpen = signal(false);

  private readonly _tenant = this.tenantState.tenant;
  protected readonly tenantLoaded = computed(() => this.tenantState.status() === 'loaded');
  protected readonly tenantLogo = computed(() => this._tenant()?.logoUrl || null);
  protected readonly tenantName = computed(() =>
    this._tenant()?.name || this.auth.user()?.tenantName || 'Your organization'
  );
  private readonly _brandingMode = computed(() => this._tenant()?.brandingMode ?? 'both');
  protected readonly brandingName = computed(() => {
    const t = this._tenant();
    return t?.brandingName?.trim() || t?.name?.trim() || null;
  });
  protected readonly showLogo = computed(() => {
    const m = this._brandingMode();
    return m === 'logo' || m === 'both';
  });
  protected readonly showName = computed(() => {
    const m = this._brandingMode();
    return m === 'name' || m === 'both';
  });
  protected readonly hasBrand = computed(() =>
    (this.showLogo() && !!this.tenantLogo()) || (this.showName() && !!this.brandingName())
  );
  protected readonly tenantInitial = computed(() => {
    const name = this.brandingName() || this.tenantName();
    return name ? name[0].toUpperCase() : '?';
  });

  ngOnInit(): void {
    const u = this.auth.user();
    if (u?.branchName) this.branch.set(u.branchName);
    this.tenantState.ensureLoaded();
  }

  toggleBranch(): void { this.branchOpen.update(v => !v); }
  selectBranch(b: string): void { this.branch.set(b); this.branchOpen.set(false); }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.branchOpen()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this.branchOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.branchOpen.set(false); }
}
