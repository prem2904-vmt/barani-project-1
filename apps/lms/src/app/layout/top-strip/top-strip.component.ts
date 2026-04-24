import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from '../../shared/components/notification-bell/notification-bell.component';
import { MORE_NAV, NavItem, PRIMARY_NAV } from '../nav-items';

@Component({
  selector: 'pf-top-strip',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NotificationBellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sticky top-0 z-40 safe-area-top px-3 sm:px-4 pt-3 sm:pt-4">
      <div class="pf-topstrip-bar relative flex items-center gap-2 rounded-full backdrop-blur-2xl border"
           style="background: var(--header-bg); border-color: var(--header-border);">

        <!-- Brand lockup — PF glyph · pulse · PREFRONTAL · LMS subtitle.
             Goes to /admin landing. Branch switching lives on the tenant
             brand pill (right side). -->
        <a routerLink="/admin" class="pf-brand-lockup press" aria-label="Prefrontal · Lab Management System · Home">
          <svg class="pf-brand-glyph" viewBox="0 0 228 292" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="pfBrandGradient" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%"   stop-color="#7c3aed"/>
                <stop offset="25%"  stop-color="#8b5cf6"/>
                <stop offset="50%"  stop-color="#a855f7"/>
                <stop offset="75%"  stop-color="#d946ef"/>
                <stop offset="100%" stop-color="#ec4899"/>
              </linearGradient>
            </defs>
            <path d="M0 131.126V292H30.1634C29.572 247.788 28.744 156.113 30.1634 143.106C31.5829 130.099 40.2179 118.861 44.358 114.867C79.8444 80.639 117.696 104.599 132.187 120.857V81.4947C125.799 74.649 101.136 70.0852 89.6031 68.659C39.9222 63.1824 9.16731 108.022 0 131.126Z"
                  fill="url(#pfBrandGradient)"/>
            <path d="M99 204C76.2887 212.215 47.6109 193.023 38.1479 182.469V220.976C126.154 259.996 162.35 199.583 169.447 164.499H227.113V136.26L171.222 137.116V72.0819C177.609 35.1151 211.735 26.4439 228 26.7291V0.201972C161.463 -4.07659 142.833 60.9576 140.171 68.659C137.51 76.3604 141.058 161.932 136.623 172.2L136.585 172.287C132.16 182.532 127.31 193.76 99 204Z"
                  fill="url(#pfBrandGradient)"/>
          </svg>

          <svg class="pf-brand-pulse" viewBox="0 0 56 24" fill="none" aria-hidden="true">
            <path class="pf-brand-pulse-path"
                  d="M0,12 L8,12 L16,3 L24,21 L32,8 L38,16 L44,12 L56,12"/>
          </svg>

          <span class="pf-brand-text">
            <span class="pf-brand-name">PREFRONTAL</span>
            <span class="pf-brand-sub">Lab Management System</span>
          </span>
        </a>

        <div class="flex-1 min-w-0"></div>

        <!-- Desktop nav (hidden < md so bottom-nav is the only nav on mobile).
             Absolute-centered so it stays in the middle regardless of left/right
             cluster widths. -->
        <nav class="pf-topnav-center hidden xl:flex">
          @for (n of primary(); track n.id) {
            <a [routerLink]="n.href"
               routerLinkActive="pf-topnav-active"
               [routerLinkActiveOptions]="{ exact: !!n.exact }"
               class="pf-topnav-btn press">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path [attr.d]="n.iconPath"/>
              </svg>
              <span>{{ n.label }}</span>
            </a>
          }

          <!-- More popover (desktop) -->
          <div class="relative" [class.hidden]="more().length === 0">
            <button type="button"
                    class="pf-topnav-btn press"
                    [class.pf-topnav-active]="moreOpen()"
                    (click)="toggleMore()"
                    aria-label="More">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5"  cy="12" r="1.8"/>
                <circle cx="12" cy="12" r="1.8"/>
                <circle cx="19" cy="12" r="1.8"/>
              </svg>
              <span>More</span>
            </button>
            @if (moreOpen()) {
              <div #moreRef class="pf-more-pop">
                <span class="pf-more-accent" aria-hidden="true"></span>
                <div class="grid grid-cols-3 gap-1.5 p-3">
                  @for (n of more(); track n.id) {
                    <a [routerLink]="n.href"
                       routerLinkActive="pf-more-pop-active"
                       (click)="closeMore()"
                       class="pf-more-pop-item press">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path [attr.d]="n.iconPath"/>
                      </svg>
                      <span class="text-[11.5px] font-medium leading-tight text-center mt-1">{{ n.label }}</span>
                    </a>
                  }
                </div>
              </div>
            }
          </div>
        </nav>

        <!-- Right cluster -->

        <pf-notification-bell></pf-notification-bell>

        <div class="w-px h-6 mx-1 hidden sm:block" style="background: var(--border-muted);"></div>

        <!-- Tenant brand pill doubles as branch switcher. Click the
             logo/name → opens branch dropdown. Branding settings is
             reachable from the profile popover.
             Only renders once the tenant fetch has resolved so the
             "YOUR LOGO" placeholder doesn't flash before real branding
             loads. -->
        @if (tenantLoaded()) {
        <div class="relative hidden sm:block">
          <button type="button"
                  class="pf-vendor-logo press"
                  [class.pf-vendor-logo-empty]="!hasBrand()"
                  [class.pf-vendor-logo--open]="branchOpen()"
                  [attr.aria-expanded]="branchOpen()"
                  [attr.aria-label]="'Switch branch — currently ' + branch()"
                  (click)="toggleBranch()">
            @if (showLogo() && tenantLogo()) {
              <img [src]="tenantLogo()!" [alt]="tenantName()" class="pf-vendor-logo-img" />
            }
            @if (showName() && brandingName(); as label) {
              <span class="pf-vendor-logo-text">{{ label }}</span>
            }
            @if (!hasBrand()) {
              <span class="pf-vendor-logo-text">YOUR LOGO</span>
            }
            <svg class="pf-vendor-logo-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>

          @if (branchOpen()) {
            <div class="pf-brand-pop" role="menu">
              <div class="pf-brand-pop__head">
                <span class="pf-brand-pop__eyebrow">Active branch</span>
                <p class="pf-brand-pop__current">{{ branch() }}</p>
              </div>
              <div class="pf-brand-pop__divider"></div>
              @for (b of branches; track b) {
                <button type="button"
                        (click)="selectBranch(b)"
                        class="pf-brand-pop__item"
                        [class.pf-brand-pop__item--active]="b === branch()">
                  <span class="truncate">{{ b }}</span>
                  @if (b === branch()) {
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m5 12 4 4L19 6"/>
                    </svg>
                  }
                </button>
              }
            </div>
          }
        </div>
        }

        <!-- Profile avatar — click to open name / role / logout -->
        <div class="relative">
          <button type="button"
                  class="pf-avatar-btn press"
                  (click)="toggleProfile()"
                  [attr.aria-expanded]="profileOpen()"
                  [attr.aria-label]="'Profile menu — ' + userName()">
            <span class="pf-avatar-circle">{{ initials() }}</span>
            @if (profileOpen()) { <span class="pf-avatar-ring" aria-hidden="true"></span> }
          </button>

          @if (profileOpen()) {
            <div class="pf-profile-pop" role="menu">
              <span class="pf-profile-accent" aria-hidden="true"></span>

              <header class="pf-profile-head">
                <span class="pf-profile-bigcircle">{{ initials() }}</span>
                <div class="min-w-0 flex-1">
                  <p class="text-[14px] font-semibold truncate"
                     style="color: var(--text-primary);">{{ userName() }}</p>
                  <p class="text-[11px] font-mono uppercase tracking-[0.16em] mt-0.5"
                     style="color: var(--text-muted);">admin · mock</p>
                </div>
              </header>

              <div class="pf-profile-divider"></div>

              <a routerLink="/setup" class="pf-profile-item press"
                 (click)="closeProfile()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/>
                </svg>
                <span>Tenant branding</span>
              </a>

              <button type="button" class="pf-profile-item press"
                      (click)="themeService.toggle(); closeProfile()">
                @if (isDark()) {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
                  </svg>
                  <span>Switch to light</span>
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 14.5A8 8 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>
                  </svg>
                  <span>Switch to dark</span>
                }
              </button>

              <button type="button" class="pf-profile-item pf-profile-danger press"
                      (click)="logout()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <path d="m16 17 5-5-5-5"/>
                  <path d="M21 12H9"/>
                </svg>
                <span>Sign out</span>
              </button>
            </div>
          }
        </div>
      </div>
    </header>
  `,
  styles: [`
    /* Top strip bar — fixed 64px+ height so every interactive element
     * inside it can adopt a consistent vertical rhythm. Padding + children
     * (44px pills) = 64px exact. */
    .pf-topstrip-bar {
      min-height: 64px;
      padding: 10px 16px 10px 12px;
    }
    @media (max-width: 639px) {
      .pf-topstrip-bar { padding: 8px 12px; min-height: 60px; }
    }

    /* Brand lockup — PF glyph + ECG pulse + PREFRONTAL + branch switcher */
    .pf-brand-lockup {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      padding: 4px 10px 4px 4px;
      border-radius: 9999px;
      text-decoration: none;
      background: transparent;
      border: none;
      cursor: pointer;
      color: inherit;
      transition: background 0.15s ease, opacity 0.2s ease;
    }
    .pf-brand-lockup:hover { background: var(--bg-hover); opacity: 0.96; }
    .pf-brand-lockup--open { background: var(--bg-hover); }

    .pf-brand-chev {
      color: var(--text-muted);
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }
    .pf-brand-lockup--open .pf-brand-chev { transform: rotate(180deg); color: var(--text-primary); }

    .pf-brand-branch-icon {
      display: inline-block;
      margin-right: 4px;
      vertical-align: -1px;
      color: #a855f7;
    }

    .pf-brand-glyph {
      width: 30px;
      height: auto;
      flex-shrink: 0;
      filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.35));
    }

    .pf-brand-pulse {
      width: 42px;
      height: 20px;
      overflow: visible;
      display: none;
      flex-shrink: 0;
    }
    .pf-brand-pulse-path {
      fill: none;
      stroke: #a855f7;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 100;
      stroke-dashoffset: 100;
      animation:
        pf-brand-pd   2.5s ease-in-out infinite,
        pf-brand-glow 2.5s ease-in-out infinite;
    }
    :root.light .pf-brand-pulse-path {
      stroke: #7c3aed;
      animation:
        pf-brand-pd         2.5s ease-in-out infinite,
        pf-brand-glow-light 2.5s ease-in-out infinite;
    }

    .pf-brand-text {
      display: none;
      flex-direction: column;
      align-items: flex-start;
      line-height: 1;
      gap: 3px;
      margin-left: -2px;
    }
    .pf-brand-name {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.12em;
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
      animation: pf-brand-name-beat 2.5s ease-in-out infinite;
    }
    .pf-brand-sub {
      display: inline-flex;
      align-items: center;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      white-space: nowrap;
      color: var(--text-secondary);
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    :root.light .pf-brand-sub { color: #7c3aed; }

    /* Branch popover hanging off the brand lockup ------------- */
    .pf-brand-pop {
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
      z-index: 40;
      overflow: hidden;
      animation: pf-pop-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .pf-brand-pop__head { padding: 10px 12px 6px; }
    .pf-brand-pop__eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-brand-pop__current {
      margin: 4px 0 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-brand-pop__divider {
      height: 1px;
      margin: 4px 8px;
      background: var(--border-muted);
    }
    .pf-brand-pop__item {
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
    .pf-brand-pop__item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-brand-pop__item--active {
      background: var(--gradient-primary);
      color: #ffffff;
    }
    .pf-brand-pop__item--active:hover {
      background: var(--gradient-primary);
      color: #ffffff;
    }

    /* Reveal brand lockup progressively: pulse at tablet, wordmark only when
     * there's room alongside the centered desktop nav (xl+). */
    @media (min-width: 768px) {
      .pf-brand-pulse { display: block; }
    }
    @media (min-width: 1280px) {
      .pf-brand-text { display: flex; }
    }

    @keyframes pf-brand-pd {
      0%           { stroke-dashoffset:  100; opacity: 0.3; }
      40%, 60%     { stroke-dashoffset:    0; opacity: 1; }
      100%         { stroke-dashoffset: -100; opacity: 0.3; }
    }
    @keyframes pf-brand-glow {
      0%, 35%, 100% { filter: drop-shadow(0 0 2px rgba(168, 85, 247, 0.3)); stroke-width: 1.6; stroke: #a855f7; }
      45%           { filter: drop-shadow(0 0 10px rgba(236, 72, 153, 0.9)); stroke-width: 2.2; stroke: #ec4899; }
      55%           { filter: drop-shadow(0 0 3px rgba(168, 85, 247, 0.4));  stroke-width: 1.6; stroke: #a855f7; }
    }
    @keyframes pf-brand-glow-light {
      0%, 35%, 100% { filter: drop-shadow(0 0 2px rgba(124, 58, 237, 0.3)); stroke-width: 1.6; stroke: #7c3aed; }
      45%           { filter: drop-shadow(0 0 8px rgba(219, 39, 119, 0.8));  stroke-width: 2.2; stroke: #db2777; }
      55%           { filter: drop-shadow(0 0 3px rgba(124, 58, 237, 0.3));  stroke-width: 1.6; stroke: #7c3aed; }
    }
    @keyframes pf-brand-name-beat {
      0%, 35%, 100% { opacity: 0.9; transform: scale(1);    filter: none; }
      45%           { opacity: 1;   transform: scale(1.03); filter: drop-shadow(0 0 6px rgba(236, 72, 153, 0.55)); }
      55%           { opacity: 1;   transform: scale(1.01); filter: drop-shadow(0 0 3px rgba(168, 85, 247, 0.35)); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pf-brand-pulse-path, .pf-brand-name { animation: none; }
      .pf-brand-pulse-path { stroke-dashoffset: 0; opacity: 1; }
    }

    .pf-strip-btn {
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      transition: all 0.15s ease;
    }
    .pf-strip-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-strip-chip {
      background: var(--glass-bg);
      color: var(--text-primary);
      border: 1px solid var(--glass-border);
      transition: all 0.15s ease;
    }
    .pf-strip-chip:hover {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }

    .pf-branch-item  { color: var(--text-secondary); }
    .pf-branch-item:hover { background: var(--bg-hover); color: var(--text-primary); }
    .pf-branch-active {
      background: var(--gradient-primary);
      color: #ffffff;
    }

    /* Desktop inline nav --------------------------------------- */
    .pf-topnav-center {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      align-items: center;
      gap: 4px;
      /* Sits on top of the flex-1 spacer so clusters hug the edges. */
      pointer-events: auto;
      z-index: 1;
    }
    .pf-topnav-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 2.75rem;
      padding: 0 14px;
      border-radius: 9999px;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .pf-topnav-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-topnav-active {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
    }
    .pf-topnav-active svg { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25)); }

    /* More popover -------------------------------------------- */
    .pf-more-pop {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      width: 320px;
      border-radius: 18px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      z-index: 40;
      overflow: hidden;
      animation: pf-pop-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .pf-more-accent {
      position: absolute;
      top: 0;
      left: 12%;
      right: 12%;
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(168, 85, 247, 0.7) 50%, transparent 100%);
    }
    .pf-more-pop-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 14px 6px;
      border-radius: 14px;
      color: var(--text-secondary);
      background: var(--glass-bg);
      border: 1px solid transparent;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.08s ease;
    }
    .pf-more-pop-item:hover {
      color: var(--text-primary);
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }
    .pf-more-pop-item:active { transform: scale(0.97); }
    .pf-more-pop-active {
      background: var(--gradient-primary) !important;
      color: #ffffff !important;
      border-color: transparent !important;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
    }

    @keyframes pf-pop-in {
      from { opacity: 0; transform: translateY(-6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Profile avatar + popover ------------------------------- */
    .pf-avatar-btn {
      position: relative;
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 9999px;
      padding: 0;
      background: transparent;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .pf-avatar-circle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.4rem;
      height: 2.4rem;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.02em;
      font-variant-numeric: tabular-nums;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .pf-avatar-btn:hover .pf-avatar-circle { transform: scale(1.05); box-shadow: 0 6px 18px rgba(124, 58, 237, 0.45); }
    .pf-avatar-btn:active .pf-avatar-circle { transform: scale(0.96); }

    /* Gradient ring that appears while the popover is open. */
    .pf-avatar-ring {
      position: absolute;
      inset: -3px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      z-index: -1;
      filter: blur(4px);
      opacity: 0.55;
      animation: pf-avatar-ring-pulse 1.6s ease-in-out infinite;
    }
    @keyframes pf-avatar-ring-pulse {
      0%, 100% { opacity: 0.35; transform: scale(1); }
      50%      { opacity: 0.7;  transform: scale(1.08); }
    }

    .pf-profile-pop {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      width: 260px;
      border-radius: 18px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      z-index: 40;
      overflow: hidden;
      padding: 6px;
      animation: pf-pop-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .pf-profile-accent {
      position: absolute;
      top: 0;
      left: 14%;
      right: 14%;
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(168, 85, 247, 0.75) 50%, transparent 100%);
    }

    .pf-profile-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 12px 12px;
    }
    .pf-profile-bigcircle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      font-weight: 600;
      font-size: 16px;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.38);
      flex-shrink: 0;
    }

    .pf-profile-divider {
      height: 1px;
      margin: 4px 8px 6px;
      background: var(--border-muted);
    }

    .pf-profile-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      background: transparent;
      border: none;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      text-align: left;
    }
    .pf-profile-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-profile-item svg { flex-shrink: 0; }

    .pf-profile-danger { color: #fca5a5; }
    .pf-profile-danger:hover {
      background: rgba(239, 68, 68, 0.14);
      color: #fca5a5;
    }

    /* Vendor brand slot (logo / name / both) ------------------ */
    .pf-vendor-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 2.75rem;
      padding: 0 14px;
      margin: 0 4px;
      border-radius: 14px;
      text-decoration: none;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      /* 140 (text) + 80 (logo) + 12 (chev) + 16 (inner gaps) + 24 (padding). */
      max-width: 280px;
    }
    .pf-vendor-logo:hover {
      transform: translateY(-1px);
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }
    .pf-vendor-logo-empty {
      border-style: dashed;
      border-color: rgba(236, 72, 153, 0.55);
      background: rgba(236, 72, 153, 0.05);
    }
    .pf-vendor-logo-empty:hover {
      background: rgba(236, 72, 153, 0.12);
      border-color: #ec4899;
    }
    .pf-vendor-logo-text {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--text-primary);
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      /* Sized to fit 10 characters of wide uppercase glyphs (e.g. "WWWWWWWWWW")
       * with the current font + letter-spacing. Anything shorter fits with
       * room to spare; anything longer still ellipses. */
      max-width: 140px;
    }
    .pf-vendor-logo-empty .pf-vendor-logo-text {
      color: #ec4899;
      letter-spacing: 0.14em;
    }
    :root.light .pf-vendor-logo-empty .pf-vendor-logo-text { color: #db2777; }

    .pf-vendor-logo-img {
      max-height: 1.6rem;
      max-width: 5rem;
      object-fit: contain;
      display: block;
      flex-shrink: 0;
    }
    .pf-vendor-logo-chev {
      color: var(--text-muted);
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }
    .pf-vendor-logo--open {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }
    .pf-vendor-logo--open .pf-vendor-logo-chev {
      transform: rotate(180deg);
      color: var(--text-primary);
    }


    @media (prefers-reduced-motion: reduce) {
      .pf-more-pop, .pf-profile-pop { animation: none; }
      .pf-avatar-ring { animation: none; }
    }
  `]
})
export class TopStripComponent implements OnInit, OnDestroy {
  protected readonly themeService = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly moduleLabel = 'LMS';
  readonly branches = ['Chennai Main', 'Anna Nagar', 'T. Nagar', 'OMR'];
  private readonly visible = (items: NavItem[]): NavItem[] => {
    const mode = this.labCfg.collectionMode();
    return items.filter(i => {
      if (i.permissions?.length && !this.auth.hasAnyPermission(i.permissions)) return false;
      if (i.collectionModes && !i.collectionModes.includes(mode)) return false;
      return true;
    });
  };
  readonly primary = computed(() => this.visible(PRIMARY_NAV));
  readonly more = computed(() => this.visible(MORE_NAV));

  protected readonly branch = signal<string>('Chennai Main');
  protected readonly branchOpen = signal(false);
  protected readonly moreOpen = signal(false);
  protected readonly profileOpen = signal(false);
  // Pulls from the shared service so branding saves reflect instantly.
  private readonly _tenant = this.tenantState.tenant;
  // Gate the brand pill on this so the "YOUR LOGO" placeholder doesn't
  // flash before the first /api/tenants/current resolves.
  readonly tenantLoaded = computed(() => this.tenantState.status() === 'loaded');

  readonly isDark = computed(() => this.themeService.isDark());
  readonly userName = () => this.auth.user()?.displayName || 'User';
  readonly tenantLogo = computed(() => this._tenant()?.logoUrl || null);
  readonly tenantName = computed(() => this._tenant()?.name || this.auth.user()?.tenantName || 'Your organization');

  // Branding mode resolution. Default 'both' when unset so existing tenants
  // keep rendering what they already had. The name falls back to a
  // 10-char slice of the official name when the admin hasn't set an
  // explicit brandingName.
  private readonly _brandingMode = computed(() => this._tenant()?.brandingMode ?? 'both');
  readonly brandingName = computed(() => {
    const t = this._tenant();
    const explicit = t?.brandingName?.trim();
    if (explicit) return explicit.slice(0, 10);
    const full = t?.name?.trim();
    return full ? full.slice(0, 10) : null;
  });
  readonly showLogo = computed(() => {
    const m = this._brandingMode();
    return m === 'logo' || m === 'both';
  });
  readonly showName = computed(() => {
    const m = this._brandingMode();
    return m === 'name' || m === 'both';
  });
  readonly hasBrand = computed(() => {
    const logoOk = this.showLogo() && !!this.tenantLogo();
    const nameOk = this.showName() && !!this.brandingName();
    return logoOk || nameOk;
  });
  readonly brandAriaLabel = computed(() => {
    if (!this.hasBrand()) return 'Add your organization logo or name';
    return `${this.tenantName()} — branding`;
  });
  readonly initials = () => {
    const u = this.auth.user();
    const first = (u?.firstName || '').trim();
    const fathers = (u?.fathersName || '').trim();
    if (first || fathers) {
      return ((first[0] || '') + (fathers[0] || '')).toUpperCase() || 'U';
    }
    const n = (u?.displayName || '').trim();
    return n.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'U';
  };

  ngOnInit() {
    const u = this.auth.user();
    if (u?.branchName) this.branch.set(u.branchName);
    this.tenantState.ensureLoaded();
    this.labCfg.ensureLoaded();
  }
  ngOnDestroy() { /* no-op */ }

  toggleBranch() {
    const next = !this.branchOpen();
    this.closeAll();
    this.branchOpen.set(next);
  }
  selectBranch(b: string) { this.branch.set(b); this.branchOpen.set(false); }

  toggleMore() {
    const next = !this.moreOpen();
    this.closeAll();
    this.moreOpen.set(next);
  }
  closeMore() { this.moreOpen.set(false); }

  toggleProfile() {
    const next = !this.profileOpen();
    this.closeAll();
    this.profileOpen.set(next);
  }
  closeProfile() { this.profileOpen.set(false); }

  async logout() {
    this.profileOpen.set(false);
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }

  private closeAll() {
    this.branchOpen.set(false);
    this.moreOpen.set(false);
    this.profileOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this.branchOpen() && !this.moreOpen() && !this.profileOpen()) return;
    const inside = this.host.nativeElement.contains(ev.target as Node);
    if (!inside) this.closeAll();
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.closeAll(); }
}
