import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Hero band — the canonical Prefrontal screen header (Figma 446-113).
 * Shared by every primary work screen (Frontdesk, Collect, Lab, Validate, Results).
 *
 * Anatomy:
 *   ┌ gradient band ─────────────────────────────────────┐
 *   │ Ⓜ Tenant name                     [primary actions] │
 *   │        ┌──────────────────────────────┐            │
 *   └────────│ 🔍 search …        ⌘K │ tools │────────────┘
 *            └──────────────────────────────┘  ← overlaps the band edge (-33px)
 *
 * Slots:
 *   - [band-actions]: primary right-aligned CTA buttons on the band
 *   - [band-search]: custom search projection (e.g. pf-patient-search)
 *   - [band-inline]: icons/shortcuts sitting inside the search pill (scan icon, shortcuts)
 *   - [band-tools]: trailing tools docked in the pill (e.g. scan trigger, cart, segment tabs)
 */
@Component({
  selector: 'pf-hero-band',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-hb">
      <div class="pf-hb__band">
        <div class="pf-hb__tenant">
          @if (back()) {
            <button type="button" class="pf-hb__back press" (click)="goBack()" aria-label="Go back" title="Back">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6"/>
              </svg>
            </button>
          }
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
        <div class="pf-hb__search" [class.pf-hb__search--tabs]="tabsOnly()" [class.pf-hb__search--ctx]="contextBar()"
             [class.pf-hb__search--std]="standardPill()">
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
                       [placeholder]="placeholder()"
                       [value]="value()"
                       (input)="valueChange.emit($any($event.target).value)"
                       (keydown.enter)="submitted.emit($any($event.target).value)" />
              }
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
    .pf-hb { margin: 0 calc(-1 * var(--pf-hb-bleed, 0px)) 12px; }
    .pf-hb__band {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      min-height: 72px;
      padding: 8px 20px calc(8px + 33px);
      background-color: var(--pf-band-bg, #ffffff);
      background-image: var(--pf-band-fade, none), var(--pf-band-sweep, none);
    }
    :host-context(.dark) .pf-hb__band,
    :host-context([data-theme='dark']) .pf-hb__band {
      border-bottom: 1px solid var(--pf-band-edge, rgba(232, 121, 249, 0.18));
      box-shadow: var(--pf-band-glow, none);
    }

    .pf-hb__tenant { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .pf-hb__logo {
      height: 28px; width: auto; max-width: 150px; flex-shrink: 0; object-fit: contain;
    }
    .pf-hb__avatar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 9999px; flex-shrink: 0;
      background: rgba(255, 255, 255, 0.8); color: #1f2937;
      font-size: 14px; font-weight: 600;
    }
    :host-context(.dark) .pf-hb__avatar,
    :host-context([data-theme='dark']) .pf-hb__avatar {
      background: rgba(255, 255, 255, 0.14); color: var(--text-primary, #e5e7eb);
    }
    .pf-hb__name {
      font-size: 18px; font-weight: 600;
      color: #1f2937;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    :host-context(.dark) .pf-hb__name,
    :host-context([data-theme='dark']) .pf-hb__name { color: var(--text-primary, #e5e7eb); }

    .pf-hb__actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

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

    .pf-hb__searchrow { padding: 0 20px; margin-top: -33px; position: relative; z-index: 10; }
    .pf-hb__search {
      display: flex; align-items: center; gap: 10px;
      --pf-hb-pill-max: 1123px;
      height: 53px; max-width: var(--pf-hb-pill-max); margin-inline: auto;
      padding: 0 12px 0 20px;
      border-radius: 20px;
      background: #ffffff;
      border: 1px solid rgba(124, 58, 237, 0.1);
      box-shadow: 0 4px 16px rgba(124, 58, 237, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
    }
    :host-context(.dark) .pf-hb__search,
    :host-context([data-theme='dark']) .pf-hb__search {
      background: var(--bg-card-solid, #14141f);
      border-color: var(--glass-border, rgba(255, 255, 255, 0.12));
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .pf-hb__glass { color: #5c7185; flex-shrink: 0; }
    .pf-hb__field { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; height: 100%; }
    .pf-hb__input {
      flex: 1; min-width: 0; height: 100%;
      border: none; outline: none; background: transparent;
      font-size: 14px; font-weight: 500; font-family: inherit;
      color: #111928;
    }
    :host-context(.dark) .pf-hb__input,
    :host-context([data-theme='dark']) .pf-hb__input { color: var(--text-primary, #e5e7eb); }
    .pf-hb__input::placeholder { color: #9ca3af; }

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
    .pf-hb__tools { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  `]
})
export class HeroBandComponent {
  readonly tenantName = input<string>('Micro World');
  readonly tenantLogo = input<string | null>(null);
  readonly brandingName = input<string | null>(null);
  readonly showLogo = input<boolean>(true);
  readonly showName = input<boolean>(true);
  readonly back = input<boolean>(false);
  readonly backTo = input<string | null>(null);
  readonly placeholder = input<string>('Search patient · name, phone, MRN, ABHA…');
  readonly value = input<string>('');
  readonly tabsOnly = input<boolean>(false);
  readonly contextBar = input<boolean>(false);
  readonly standardPill = input<boolean>(false);
  readonly customSearch = input<boolean>(false);

  readonly valueChange = output<string>();
  readonly submitted = output<string>();
  readonly backAction = output<void>();

  protected readonly tenantInitial = computed(() => {
    const n = (this.brandingName() || this.tenantName()).trim();
    return n ? n.charAt(0).toUpperCase() : 'M';
  });

  protected goBack(): void {
    this.backAction.emit();
    if (typeof window !== 'undefined' && window.history) {
      window.history.back();
    }
  }
}
