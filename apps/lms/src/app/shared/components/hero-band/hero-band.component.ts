import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

/**
 * Hero band — the designer's common screen header (Figma: "Prefrontal LMS —
 * Design System", node 446-113). One pattern shared by every work screen
 * (frontdesk, collect, lab, validate, result):
 *
 *   ┌ gradient band ─────────────────────────────────────┐
 *   │ Ⓜ Tenant name                     [primary actions] │
 *   │        ┌──────────────────────────────┐            │
 *   └────────│ 🔍 search …        ⌘K │ tools │────────────┘
 *            └──────────────────────────────┘  ← overlaps the band edge
 *
 * The SEARCH is contextual per screen: frontdesk projects its patient-search
 * (suggestions + advanced modal) via `[band-search]`; queue screens bind the
 * built-in input to their live filter; intake screens use Enter-to-receive.
 * `[band-actions]` = right-side primary buttons; `[band-tools]` = icon
 * buttons docked at the search bar's right edge (scan, cart, …).
 *
 * Light theme follows the designer's world (lavender→violet gradient, white
 * pill search); dark theme maps the same anatomy onto the existing glass
 * vocabulary — same bones, theme-native skin.
 */
@Component({
  selector: 'pf-hero-band',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-hb">
      <div class="pf-hb__band">
        <div class="pf-hb__tenant">
          <!-- Real tenant branding (same resolution as the classic bar chip):
               admin-uploaded logo when branding allows it, initial disc
               otherwise; name honors brandingName + mode. -->
          @if (showLogo() && tenantLogo()) {
            <img class="pf-hb__logo" [src]="tenantLogo()!" [alt]="tenantName()" />
          } @else {
            <span class="pf-hb__avatar" aria-hidden="true">{{ tenantInitial() }}</span>
          }
          @if (showName()) {
            <span class="pf-hb__name">{{ brandingName() || tenantName() }}</span>
          }
        </div>
        <div class="pf-hb__actions"><ng-content select="[band-actions]"></ng-content></div>
      </div>

      <div class="pf-hb__searchrow">
        <div class="pf-hb__search">
          @if (customSearch()) {
            <ng-content select="[band-search]"></ng-content>
          } @else {
            <svg class="pf-hb__glass" width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input class="pf-hb__input" type="text"
                   [placeholder]="placeholder()"
                   [value]="value()"
                   (input)="valueChange.emit($any($event.target).value)"
                   (keydown.enter)="submitted.emit($any($event.target).value)" />
          }
          <div class="pf-hb__tools">
            <ng-content select="[band-tools]"></ng-content>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ── Band — exact Figma 446-113 values. Full-bleed when the host sets
       --pf-hb-bleed to its page padding. ── */
    .pf-hb { margin: 0 calc(-1 * var(--pf-hb-bleed, 0px)) 18px; }
    .pf-hb__band {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      min-height: 108px;
      padding: 14px 20px calc(14px + 33px);  /* bottom holds room for the overlap */
      background-color: #ffffff;
      background-image: linear-gradient(90deg, rgba(125, 28, 182, 0.35) 0%, rgba(173, 75, 201, 0.35) 37%,
                                        rgba(175, 34, 201, 0.35) 68%, rgba(162, 25, 110, 0.35) 100%);
    }
    :host-context(.dark) .pf-hb__band,
    :host-context([data-theme='dark']) .pf-hb__band {
      /* Owner: the light gradient wasn't "adding up" in dark — give the
         band a real violet presence on a deep base instead of a faint
         wash over transparent. */
      background-color: #1b1426;
      background-image:
        linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(10, 8, 16, 0.55) 100%),
        linear-gradient(90deg, rgba(125, 28, 182, 0.55) 0%, rgba(173, 75, 201, 0.42) 37%,
                        rgba(175, 34, 201, 0.40) 68%, rgba(162, 25, 110, 0.5) 100%);
      border-bottom: 1px solid rgba(168, 85, 247, 0.22);
    }

    .pf-hb__tenant { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .pf-hb__logo {
      height: 30px; width: auto; max-width: 150px; flex-shrink: 0;
      object-fit: contain; border-radius: 6px;
      background: rgba(255, 255, 255, 0.8); padding: 2px 4px;
    }
    .pf-hb__avatar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 9999px; flex-shrink: 0;
      background: rgba(255, 255, 255, 0.8); color: #1f2937;
      font-size: 14px; font-weight: 400;
    }
    :host-context(.dark) .pf-hb__avatar,
    :host-context([data-theme='dark']) .pf-hb__avatar {
      background: rgba(255, 255, 255, 0.14); color: var(--text-primary, #e5e7eb);
    }
    .pf-hb__name {
      font-size: 18px; font-weight: 400;
      color: #1f2937;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    :host-context(.dark) .pf-hb__name,
    :host-context([data-theme='dark']) .pf-hb__name { color: var(--text-primary, #e5e7eb); }

    .pf-hb__actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

    /* ── Search pill overlapping the band's bottom edge (53px, r20) ── */
    .pf-hb__searchrow { padding: 0 20px; margin-top: -33px; }
    .pf-hb__search {
      display: flex; align-items: center; gap: 10px;
      height: 53px; max-width: 1123px; margin-inline: auto;
      padding: 0 12px 0 20px;
      border-radius: 20px;
      background: #ffffff;
      border: none;
      box-shadow: 0 1px 1px rgba(124, 58, 237, 0.06), 0 1px 1.5px rgba(124, 58, 237, 0.15);
    }
    :host-context(.dark) .pf-hb__search,
    :host-context([data-theme='dark']) .pf-hb__search {
      background: var(--bg-card-solid, #14141f);
      border-color: var(--glass-border, rgba(255, 255, 255, 0.12));
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .pf-hb__glass { color: #5c7185; flex-shrink: 0; }
    .pf-hb__input {
      flex: 1; min-width: 0; height: 100%;
      border: none; outline: none; background: transparent;
      font-size: 14px; font-weight: 500; font-family: inherit;
      color: #111928;
    }
    :host-context(.dark) .pf-hb__input,
    :host-context([data-theme='dark']) .pf-hb__input { color: var(--text-primary, #e5e7eb); }
    .pf-hb__input::placeholder { color: #9ca3af; }

    .pf-hb__tools { display: flex; align-items: center; flex-shrink: 0; }
    /* Tool buttons (projected): divider before the group when present. */
    .pf-hb__tools:not(:empty) { border-left: 1px solid #e5e7eb; margin-left: 4px; padding-left: 8px; gap: 2px; }
    :host-context(.dark) .pf-hb__tools:not(:empty),
    :host-context([data-theme='dark']) .pf-hb__tools:not(:empty) {
      border-left-color: var(--glass-border, rgba(255, 255, 255, 0.12));
    }

    /* Frontdesk projects its own pf-patient-search — let it fill the pill. */
    .pf-hb__search ::ng-deep [band-search] { flex: 1; min-width: 0; }

    @media (max-width: 640px) {
      .pf-hb__band { padding-inline: 14px; min-height: 64px; }
      .pf-hb__searchrow { padding-inline: 8px; }
      .pf-hb__name { font-size: 15px; }
    }
  `]
})
export class HeroBandComponent {
  private readonly auth = inject(AuthService);
  private readonly tenantState = inject(TenantStateService);

  /** Placeholder for the built-in search input. */
  readonly placeholder = input<string>('Search');
  /** Controlled value for the built-in search input. */
  readonly value = input<string>('');
  /** True when the host projects its own search control via [band-search]. */
  readonly customSearch = input<boolean>(false);

  readonly valueChange = output<string>();
  /** Enter pressed in the built-in input (intake screens receive-on-enter). */
  readonly submitted = output<string>();

  readonly tenantName = computed(() =>
    this.tenantState.tenant()?.name || this.auth.user()?.tenantName || 'Your organization');

  /* Branding resolution — mirrors the classic bar's tenant chip: mode
     defaults to 'both'; brandingName falls back to the official name. */
  private readonly brandingMode = computed(() => this.tenantState.tenant()?.brandingMode ?? 'both');
  readonly tenantLogo = computed(() => this.tenantState.tenant()?.logoUrl || null);
  readonly brandingName = computed(() => this.tenantState.tenant()?.brandingName?.trim() || null);
  readonly showLogo = computed(() => this.brandingMode() === 'logo' || this.brandingMode() === 'both');
  readonly showName = computed(() => this.brandingMode() === 'name' || this.brandingMode() === 'both');
  readonly tenantInitial = computed(() =>
    ((this.brandingName() || this.tenantName()).trim()[0] ?? 'P').toUpperCase());
}
