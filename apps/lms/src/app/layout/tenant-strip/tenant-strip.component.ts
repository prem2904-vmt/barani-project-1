import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener,
  OnInit, computed, inject, signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { DialogService } from '../../core/services/dialog.service';

/**
 * Page-level tenant + branch context strip. Lives between the top
 * chrome and the routed content so every screen automatically shows
 * "where I'm working" without each page having to render it.
 *
 * Pulls tenant data from TenantStateService (same source as the
 * top-strip used to). Branch picker is local state (mock list for
 * now — same as the previous top-strip implementation).
 */
@Component({
  selector: 'pf-tenant-strip',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tenantLoaded()) {
      <div class="pf-tstrip">
        <a routerLink="/setup" class="pf-tstrip__id press"
           [class.pf-tstrip__id--empty]="!hasBrand()"
           [attr.aria-label]="hasBrand() ? (tenantName() + ' · Branding settings') : 'Set up branding'">
          @if (showLogo() && tenantLogo()) {
            <img [src]="tenantLogo()!" [alt]="tenantName()" class="pf-tstrip__img" />
          } @else {
            <span class="pf-tstrip__icon" aria-hidden="true">{{ tenantInitial() }}</span>
          }
          <span class="pf-tstrip__name">{{ tenantName() }}</span>
        </a>

        <div class="relative">
          <button type="button" class="pf-tstrip__branch press"
                  [class.pf-tstrip__branch--open]="branchOpen()"
                  [attr.aria-expanded]="branchOpen()"
                  [attr.aria-label]="'Switch branch — currently ' + branch()"
                  (click)="toggleBranch()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 21s-7-4.5-7-12a7 7 0 0 1 14 0c0 7.5-7 12-7 12Z"/>
              <circle cx="12" cy="9" r="2.5"/>
            </svg>
            <span class="pf-tstrip__branch-label">Branch</span>
            <span class="pf-tstrip__branch-value">{{ branch() }}</span>
            <svg class="pf-tstrip__chev" width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          @if (branchOpen()) {
            <div class="pf-tstrip__pop" role="menu">
              <div class="pf-tstrip__pop-head">
                <span class="pf-tstrip__pop-eyebrow">Active branch</span>
                <p class="pf-tstrip__pop-current">{{ branch() }}</p>
              </div>
              <div class="pf-tstrip__pop-divider"></div>
              @for (b of branches; track b) {
                <button type="button" (click)="selectBranch(b)" class="pf-tstrip__pop-item"
                        [class.pf-tstrip__pop-item--active]="b === branch()">
                  <span class="truncate">{{ b }}</span>
                  @if (b === branch()) {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
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
    /* Slim, transparent metadata row — no card, no border, no
     * backdrop. Sits as page-level eyebrow text just above the
     * routed content. Reads like breadcrumbs, not chrome. */
    .pf-tstrip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 22px 20px 14px;
      min-width: 0;
    }
    @media (max-width: 639px) {
      .pf-tstrip { padding: 16px 14px 8px; gap: 12px; }
    }

    /* ── Tenant slot (left) ── */
    .pf-tstrip__id {
      display: inline-flex;
      align-items: center;
      gap: 16px;
      padding: 6px 8px;
      border-radius: 12px;
      text-decoration: none;
      color: var(--text-primary);
      transition: color 0.15s ease, background 0.15s ease;
      min-width: 0;
    }
    .pf-tstrip__id:hover {
      background: rgba(168, 85, 247, 0.06);
    }
    .pf-tstrip__id--empty { color: #ec4899; }
    .pf-tstrip__img {
      height: 56px;
      max-width: 280px;
      object-fit: contain;
      display: block;
      flex-shrink: 0;
    }
    @media (max-width: 639px) {
      .pf-tstrip__img { height: 44px; max-width: 180px; }
    }
    .pf-tstrip__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: var(--gradient-primary);
      color: #fff;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }
    @media (max-width: 639px) {
      .pf-tstrip__icon { width: 42px; height: 42px; font-size: 18px; border-radius: 11px; }
    }
    .pf-tstrip__name {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.012em;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 60vw;
    }
    @media (max-width: 639px) {
      .pf-tstrip__name { font-size: 19px; max-width: 50vw; }
    }

    /* ── Branch slot (right) ── */
    .pf-tstrip__branch {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 6px;
      border-radius: 6px;
      background: transparent;
      border: none;
      color: var(--text-tertiary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-tstrip__branch:hover,
    .pf-tstrip__branch--open {
      background: rgba(168, 85, 247, 0.06);
      color: var(--text-primary);
    }
    .pf-tstrip__branch svg:first-child {
      color: var(--text-muted);
      flex-shrink: 0;
      width: 11px;
      height: 11px;
    }
    .pf-tstrip__branch:hover svg:first-child,
    .pf-tstrip__branch--open svg:first-child { color: #a855f7; }
    .pf-tstrip__branch-label {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    @media (max-width: 639px) {
      .pf-tstrip__branch-label { display: none; }
    }
    .pf-tstrip__branch-value {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .pf-tstrip__branch:hover .pf-tstrip__branch-value,
    .pf-tstrip__branch--open .pf-tstrip__branch-value { color: var(--text-primary); }
    .pf-tstrip__chev {
      color: var(--text-muted);
      transition: transform 0.2s ease, color 0.2s ease;
      flex-shrink: 0;
    }
    .pf-tstrip__branch--open .pf-tstrip__chev {
      transform: rotate(180deg);
      color: var(--text-primary);
    }

    /* ── Branch popover ── */
    .pf-tstrip__pop {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 220px;
      padding: 6px;
      border-radius: 14px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      z-index: 30;
      overflow: hidden;
      animation: pf-tstrip-pop 0.16s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    @keyframes pf-tstrip-pop {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .pf-tstrip__pop-head { padding: 8px 10px 4px; }
    .pf-tstrip__pop-eyebrow {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-tstrip__pop-current {
      margin: 3px 0 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-tstrip__pop-divider {
      height: 1px;
      margin: 4px 6px;
      background: var(--border-muted);
    }
    .pf-tstrip__pop-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      text-align: left;
    }
    .pf-tstrip__pop-item:hover { background: var(--bg-hover); color: var(--text-primary); }
    .pf-tstrip__pop-item--active {
      background: var(--gradient-primary);
      color: #fff;
    }
    .pf-tstrip__pop-item--active:hover { background: var(--gradient-primary); color: #fff; }
  `]
})
export class TenantStripComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly dialog = inject(DialogService);

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
    const explicit = t?.brandingName?.trim();
    if (explicit) return explicit;
    const full = t?.name?.trim();
    return full || null;
  });
  protected readonly showLogo = computed(() => {
    const m = this._brandingMode();
    return m === 'logo' || m === 'both';
  });
  protected readonly showName = computed(() => {
    const m = this._brandingMode();
    return m === 'name' || m === 'both';
  });
  protected readonly hasBrand = computed(() => {
    const logoOk = this.showLogo() && !!this.tenantLogo();
    const nameOk = this.showName() && !!this.brandingName();
    return logoOk || nameOk;
  });
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
  async selectBranch(b: string): Promise<void> {
    if (b === this.branch()) {
      this.branchOpen.set(false);
      return;
    }
    const ok = await this.dialog.confirm({
      title: 'Switch active branch?',
      message: `Are you sure you want to switch the active branch to "${b}"?`,
      confirmLabel: 'Yes, switch branch',
      cancelLabel: 'Cancel',
      tone: 'primary'
    });
    if (!ok) return;
    this.branch.set(b);
    this.branchOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    if (!this.branchOpen()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this.branchOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.branchOpen.set(false); }
}
