import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NavBackService } from '../../../core/services/nav-back.service';
import { injectTenantBrand } from './tenant-brand';
import { PfKeysDirective } from '../numpad/pf-keys.directive';
import { SamplePresetDirective } from '../../directives/sample-preset.directive';
import { PfKeysKind } from '../numpad/pf-keys-layouts';

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
 * Admin sub-pages (owner, "band pill everywhere"):
 *   • `back` — a back chevron at the band's top-left, since the page's own
 *     title/header (which used to carry it) is gone. `backTo` names the
 *     parent route; without it NavBackService pops history.
 *   • `tabsOnly` — a page with NO search but with sections puts those
 *     sections in the pill as tabs: no search field, the projected
 *     `[band-tools]` (a pf-segmented) spans the whole pill.
 *
 * Light theme follows the designer's world (lavender→violet gradient, white
 * pill search); dark theme maps the same anatomy onto the existing glass
 * vocabulary — same bones, theme-native skin.
 */
@Component({
  selector: 'pf-hero-band',
  standalone: true,
  imports: [PfKeysDirective, SamplePresetDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-hb">
      <div class="pf-hb__band">
        <div class="pf-hb__tenant">
          @if (back() && (navBack.showBack() || !!backAction())) {
            <button type="button" class="pf-hb__back press" (click)="goBack()" aria-label="Go back" title="Back">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
          }
          <!-- Real tenant branding (same resolution as the classic bar chip):
               admin-uploaded logo when branding allows it, initial disc
               otherwise; name honors brandingName + mode. -->
          <!-- customBrand: the screen projects its own button around the SAME mark ([band-brand], resolved by
               injectTenantBrand) — the case sheet's tap = Departments / hold = voice note (owner 2026-11-11). -->
          @if (customBrand()) {
            <ng-content select="[band-brand]"></ng-content>
          } @else if (showLogo() && tenantLogo()) {
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
        <div class="pf-hb__search" [class.pf-hb__search--tabs]="tabsOnly()" [class.pf-hb__search--ctx]="contextBar()"
             [class.pf-hb__search--std]="standardPill()">
          <!-- The field (icon + input + scan icons) is one unit. On
               tablet/desktop it is display:contents, i.e. INVISIBLE to
               layout — the pill renders exactly as before. On phones it
               becomes the pill so the filters can drop to their own row. -->
          @if (!tabsOnly()) {
          <div class="pf-hb__field">
          @if (customSearch()) {
            <ng-content select="[band-search]"></ng-content>
          } @else {
            <svg class="pf-hb__glass" width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input class="pf-hb__input" type="text"
                   [pfKeys]="keys()" [pfKeysEnter]="keysEnter()" [pfKeysEnterAria]="keysEnterAria()"
                   [pfSamplePreset]="keys() === 'sample'"
                   [attr.aria-label]="keys() ? placeholder() : null"
                   [placeholder]="placeholder()"
                   [value]="value()"
                   (input)="valueChange.emit($any($event.target).value)"
                   (keydown.enter)="submitted.emit($any($event.target).value)" />
          }
          <!-- Anything that FEEDS the search (camera scan, voice, ⌘K) rides
               inside the field, BEFORE the divider (owner) — it's part of
               typing, not a tool sitting next to the bar. -->
          <div class="pf-hb__inline">
            <ng-content select="[band-inline]"></ng-content>
          </div>
          </div>
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
    .pf-hb { margin: 0 calc(-1 * var(--pf-hb-bleed, 0px)) 12px; }
    .pf-hb__band {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      /* Tightened (owner): the tenant row and the search pill were ~27px
         apart on a 108px band — that empty gap gave the page nothing. Now the
         band hugs its content (~10px of air above the pill) and hands the
         reclaimed height back to the screen. */
      min-height: 72px;
      padding: 8px 20px calc(8px + 33px);  /* bottom holds room for the overlap */
      /* Colours come from --pf-band-* in styles.scss so the band and the
         docked bottom bar can never drift apart, and dimming is one edit
         in one place (owner asked twice). */
      background-color: var(--pf-band-bg, #ffffff);
      background-image: var(--pf-band-fade), var(--pf-band-sweep);
    }
    /* Dark differs only in the variable VALUES (styles.scss), so the rule
       here is just the edge. */
    :host-context(.dark) .pf-hb__band,
    :host-context([data-theme='dark']) .pf-hb__band {
      border-bottom: 1px solid var(--pf-band-edge);
      /* Soft violet bloom below the bottom edge (dark only; styles.scss). */
      box-shadow: var(--pf-band-glow, none);
    }

    .pf-hb__tenant { display: flex; align-items: center; gap: 12px; min-width: 0; flex-shrink: 0; }
    .pf-hb__logo {
      /* The tenant uploads a PNG with transparency — no backing plate
         (owner); it sits directly on the band gradient. */
      height: 28px; width: auto; max-width: 150px; flex-shrink: 0;
      object-fit: contain;
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

    /* Back chevron (admin sub-pages): bare chevron, generous tap target,
       pulled toward the edge like the native back affordance. */
    .pf-hb__back {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; margin-left: -8px; flex-shrink: 0;
      border-radius: 10px; border: 0; background: transparent; cursor: pointer;
      color: #1f2937; -webkit-tap-highlight-color: transparent;
      transition: background 160ms ease;
    }
    .pf-hb__back:hover { background: rgba(124, 58, 237, 0.08); }
    :host-context(.dark) .pf-hb__back,
    :host-context([data-theme='dark']) .pf-hb__back { color: var(--text-primary, #e5e7eb); }
    :host-context(.dark) .pf-hb__back:hover,
    :host-context([data-theme='dark']) .pf-hb__back:hover { background: rgba(255, 255, 255, 0.08); }

    /* Tabs-only pill: no search field, the tools own the whole pill and the
       section switch is spread evenly across it (owner). */
    .pf-hb__search--tabs { padding-left: 12px; }
    .pf-hb__search--tabs .pf-hb__tools,
    .pf-hb__search--tabs .pf-hb__tools:not(:empty),
    :host-context(.dark) .pf-hb__search--tabs .pf-hb__tools:not(:empty),
    :host-context([data-theme='dark']) .pf-hb__search--tabs .pf-hb__tools:not(:empty) {
      flex: 1 1 auto; min-width: 0; border-left: 0; margin-left: 0; padding-left: 0;
    }
    .pf-hb__search--tabs .pf-hb__tools ::ng-deep pf-segmented.pf-hb-tabs { flex: 1 1 auto; min-width: 0; }
    .pf-hb__search--tabs .pf-hb__tools ::ng-deep pf-segmented.pf-hb-tabs .bar { display: flex; width: 100%; }
    .pf-hb__search--tabs .pf-hb__tools ::ng-deep pf-segmented.pf-hb-tabs .seg-item { flex: 1 1 0; white-space: nowrap; }

    /* Context-bar pill (editors): the record's identity chips may need a
       second row at tablet widths — the pill grows instead of clipping. */
    .pf-hb__search.pf-hb__search--ctx { height: auto; min-height: 53px; padding-block: 4px; max-width: none; }
    /* …unless the page asks for the STANDARD pill: the search pill's own
       max-width + centring (Order & Payments, My Work…), whatever it holds. */
    .pf-hb__search.pf-hb__search--ctx.pf-hb__search--std { max-width: var(--pf-hb-pill-max); }

    /* ── Search pill overlapping the band's bottom edge (53px, r20) ── */
    .pf-hb__searchrow { padding: 0 20px; margin-top: -33px; }
    .pf-hb__search {
      display: flex; align-items: center; gap: 10px;
      --pf-hb-pill-max: 1123px;
      height: 53px; max-width: var(--pf-hb-pill-max); margin-inline: auto;
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

    /* Search-feeding / inline quick actions: subtle divider separating from search input */
    .pf-hb__inline { display: flex; align-items: center; flex-shrink: 0; }
    .pf-hb__inline:not(:empty) {
      gap: 6px;
      margin-left: 6px;
      padding-left: 8px;
      border-left: 1px solid var(--pf-line, #e2e8f0);
    }
    :host-context(.dark) .pf-hb__inline:not(:empty),
    :host-context([data-theme='dark']) .pf-hb__inline:not(:empty) {
      border-left-color: var(--glass-border, rgba(255, 255, 255, 0.12));
    }
    .pf-hb__tools { display: flex; align-items: center; flex-shrink: 0; }
    /* Tool buttons (projected): divider before the group when present. */
    .pf-hb__tools:not(:empty) { border-left: 1px solid #e5e7eb; margin-left: 4px; padding-left: 8px; gap: 6px; }
    /* Filter strips ride in here too — keep them from stretching the pill. */
    .pf-hb__tools pf-segmented { flex-shrink: 0; }
    :host-context(.dark) .pf-hb__tools:not(:empty),
    :host-context([data-theme='dark']) .pf-hb__tools:not(:empty) {
      border-left-color: var(--glass-border, rgba(255, 255, 255, 0.12));
    }

    /* Frontdesk projects its own pf-patient-search — let it fill the pill
       and FLATTEN its chrome: the pill is the one and only box, so the
       inner field drops its own border/background/focus ring (owner: it
       read as a text box inside a search bar). */
    .pf-hb__search ::ng-deep [band-search] { flex: 1; min-width: 0; }
    .pf-hb__search ::ng-deep [band-search] .pulse { display: none; }
    .pf-hb__search ::ng-deep [band-search] .field,
    .pf-hb__search ::ng-deep [band-search] .field.field-focused {
      border: none !important;
      background: transparent !important;
      box-shadow: none !important;
      border-radius: 0;
      min-height: 0;
      height: 100%;
    }
    .pf-hb__search ::ng-deep [band-search] .field input {
      font-size: 14px;
      font-weight: 500;
    }

    /* Tablet/desktop: the field wrapper does not exist as far as layout is
       concerned, so the pill is byte-for-byte what it always was. */
    .pf-hb__field { display: contents; }

    /* ════════ PHONE (<=640px) ════════════════════════════════════
       The pill was designed for a monitor. On a 390px screen it now also
       carries a filter strip with dots + counts, which would crush the
       input to nothing. So on phones the search row becomes a stack:

         ┌ field pill ─────────────── [scan] ┐
         └───────────────────────────────────┘
          ‹ All · Completed · Partial · … ›     ← own scrollable row

       Nothing here touches >=641px. */
    @media (max-width: 640px) {
      .pf-hb__band { padding-inline: 14px; min-height: 60px; }
      .pf-hb__searchrow { padding-inline: 10px; }
      .pf-hb__name { font-size: 15px; }
      /* Logo + name must yield to the action buttons, never push them off. */
      .pf-hb__tenant { gap: 8px; }
      .pf-hb__logo { height: 24px; max-width: 108px; }
      .pf-hb__actions { gap: 6px; }

      /* The row becomes a column; the pill moves onto .pf-hb__field. */
      .pf-hb__search,
      :host-context(.dark) .pf-hb__search,
      :host-context([data-theme='dark']) .pf-hb__search {
        display: flex; flex-direction: column; align-items: stretch;
        gap: 8px; height: auto; padding: 0;
        border-radius: 0; background: transparent; box-shadow: none;
      }
      .pf-hb__field {
        display: flex; align-items: center; gap: 10px;
        min-height: 50px; padding: 0 8px 0 16px;
        border-radius: 16px;
        background: #ffffff;
        box-shadow: 0 1px 1px rgba(124, 58, 237, 0.06), 0 1px 1.5px rgba(124, 58, 237, 0.15);
      }
      :host-context(.dark) .pf-hb__field,
      :host-context([data-theme='dark']) .pf-hb__field {
        background: var(--bg-card-solid, #14141f);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
      }
      .pf-hb__search.pf-hb__search--ctx { padding: 0; min-height: 0; }
      /* 16px or iOS zooms the page on focus. */
      .pf-hb__input { font-size: 16px; }
      .pf-hb__search ::ng-deep [band-search] .field input { font-size: 16px; }

      /* Filters get their own scrollable row under the pill: no divider,
         no clipping, and the scrollbar stays out of the way. */
      .pf-hb__tools,
      .pf-hb__tools:not(:empty),
      :host-context(.dark) .pf-hb__tools:not(:empty),
      :host-context([data-theme='dark']) .pf-hb__tools:not(:empty) {
        width: 100%; margin: 0; padding: 2px 2px 0;
        border-left: none; gap: 8px;
        overflow-x: auto; overflow-y: visible;
        scrollbar-width: none; -webkit-overflow-scrolling: touch;
      }
      .pf-hb__tools::-webkit-scrollbar { display: none; }
      .pf-hb__tools:empty { display: none; }
      /* Projected strips (segmented, admin's date range, the doctor queue's
         pills) must scroll as a unit, never compress. They carry the
         CONSUMER's encapsulation attribute, so this needs ::ng-deep. */
      /* Centred on phone (owner). Done with auto margins, not
         justify-content: center — when the strip is wider than the screen,
         auto margins collapse to 0 and it stays scrollable from its start,
         whereas centring a flex overflow makes the first chip unreachable. */
      .pf-hb__tools ::ng-deep pf-segmented,
      .pf-hb__tools ::ng-deep .pf-ov__filter--band,
      .pf-hb__tools ::ng-deep .dq-pills--band { flex-shrink: 0; margin-inline: auto; }
      /* Tabs-only pill on a phone: the tabs keep their natural width and
         the row scrolls, rather than squeezing every label into 390px. */
      .pf-hb__search--tabs .pf-hb__tools ::ng-deep pf-segmented.pf-hb-tabs,
      .pf-hb__search--tabs .pf-hb__tools ::ng-deep pf-segmented.pf-hb-tabs .bar { width: auto; flex: 0 0 auto; }
      .pf-hb__search--tabs .pf-hb__tools ::ng-deep pf-segmented.pf-hb-tabs .seg-item { flex: 0 0 auto; }
      .pf-hb__back { margin-left: -6px; }
      .pf-hb__tools ::ng-deep .pf-ov__range,
      .pf-hb__tools ::ng-deep .dq-pill { flex-shrink: 0; height: 36px; }

      /* Tap targets. These are projected from the screens, so ::ng-deep. */
      .pf-hb__inline ::ng-deep .pf-hb-tool,
      .pf-hb__tools ::ng-deep .pf-hb-tool { width: 44px; height: 44px; }
      /* Refresh goes icon-only: the label is a bare text node, so zero the
         font-size on the button and let the sized <svg> carry it. Keeps the
         primary action and the tenant name on screen together. */
      .pf-hb__actions ::ng-deep .pf-hb-btn--ghost {
        font-size: 0; gap: 0; padding: 0 11px; min-width: 44px; height: 38px;
      }
      /* The PRIMARY action goes icon-only too (owner: "New Patient" -> +,
         "Generate" -> an icon). Same trick: the label is a bare text node,
         so zero the button's font-size and let the sized <svg> carry it.
         The gradient stays — it is still the one primary action. */
      .pf-hb__actions ::ng-deep .pf-hb-btn--primary {
        font-size: 0; gap: 0; padding: 0 12px; min-width: 44px;
      }
      .pf-hb__actions ::ng-deep .pf-hb-btn { height: 38px; padding-inline: 14px; }
    }
    /* Very narrow phones: the tenant name is the first thing to go. */
    @media (max-width: 360px) {
      .pf-hb__name { display: none; }
    }
  `]
})
export class HeroBandComponent {
  protected readonly navBack = inject(NavBackService);

  /** Show the back chevron at the band's top-left (admin sub-pages). It only
   *  renders on secondary routes (NavBackService.showBack). */
  readonly back = input<boolean>(false);
  /** Parent route for the back chevron; without it, history pops. */
  readonly backTo = input<string | null>(null);
  /** Pill without a search field: the projected [band-tools] (section tabs)
   *  span the whole pill. */
  readonly tabsOnly = input<boolean>(false);
  /** Pill = an editor's CONTEXT BAR (identity chips projected via
   *  [band-search] with customSearch): the pill may grow to wrap them. */
  readonly contextBar = input<boolean>(false);
  /** A context-bar pill at the STANDARD search-pill size (same max-width
   *  and centring as every search page) instead of the full band width. */
  readonly standardPill = input<boolean>(false);

  /** Optional handler for the back chevron — for an in-page step (e.g. the
   *  collect drawer) whose "back" closes the step rather than navigating.
   *  When set, the chevron also shows on primary routes. Additive. */
  readonly backAction = input<(() => void) | null>(null);

  goBack(): void {
    const act = this.backAction();
    if (act) { act(); return; }
    const to = this.backTo();
    if (to) this.navBack.backTo(to);
    else this.navBack.back();
  }

  /** Placeholder for the built-in search input. */
  readonly placeholder = input<string>('Search');
  /** Controlled value for the built-in search input. */
  readonly value = input<string>('');
  /** PF Keys kind for the built-in search on tablets ('sample' for sample /
   *  tube lookups); null = the system keyboard (every other band search).
   *  'sample' also turns on the sample-ID search preset (pfSamplePreset) on
   *  every device: the field opens pre-typed with the current ID head. */
  readonly keys = input<PfKeysKind | null>(null);
  /** PF Keys primary key wording / aria-label (the band's own Enter). */
  readonly keysEnter = input<string | null>(null);
  readonly keysEnterAria = input<string | null>(null);
  /** True when the host projects its own search control via [band-search]. */
  readonly customSearch = input<boolean>(false);

  readonly valueChange = output<string>();
  /** Enter pressed in the built-in input (intake screens receive-on-enter). */
  readonly submitted = output<string>();

  /** The lab's mark + name: ONE resolution (tenant-brand.ts), shared with screens that project [band-brand].
   *  A personal case-sheet space shows the doctor instead of "Personal space cc2ee7f1". */
  private readonly brand = injectTenantBrand();
  readonly tenantName = this.brand.name;
  /** A private "/uploads/…" logo shows through the session (blob: URL). */
  readonly tenantLogo = this.brand.logo;
  readonly brandingName = this.brand.brandingName;
  readonly showLogo = this.brand.showLogo;
  readonly showName = this.brand.showName;
  readonly tenantInitial = this.brand.initial;
  /** The screen projects its own brand button ([band-brand]) in place of the plain logo / initial disc. */
  readonly customBrand = input<boolean>(false);
}
