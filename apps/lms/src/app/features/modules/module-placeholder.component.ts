import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ScreenHeaderComponent } from '../../shared/primitives/screen-header.component';
import { MODULE_CATALOG, ModuleDef, moduleDef } from '../../core/modules/module-catalog';

/**
 * Shared placeholder shell for modules that are entitled but not yet built (OPD,
 * IPD, Pharmacy, Payroll). Route supplies `data: { moduleId }`; we render the
 * module's planned features from the catalog so the nav → route → screen wiring
 * is proven end-to-end now, and each screen fills in as its module ships.
 */
@Component({
  selector: 'pf-module-placeholder',
  standalone: true,
  imports: [ScreenHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mod(); as m) {
      <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10">
        <pf-screen-header [eyebrow]="'Module'" [title]="m.label" [subtitle]="m.blurb"></pf-screen-header>

        <div class="pf-ph">
          <span class="pf-ph__glyph">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path [attr.d]="m.iconPath"></path>
            </svg>
          </span>
          <h2 class="pf-ph__title">{{ m.label }} is coming soon</h2>
          <p class="pf-ph__sub">
            This module is enabled for your organization. Its screens are being built —
            here's what it will include.
          </p>

          <div class="pf-ph__feats">
            @for (f of m.features; track f.key) {
              <div class="pf-ph__feat">
                <span class="pf-ph__dot"></span>
                <span class="pf-ph__feat-label">{{ f.label }}</span>
              </div>
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: [`
    .pf-ph {
      max-width: 620px; margin: 24px auto 0; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 40px 24px; border-radius: 20px;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      background: var(--bg-card, rgba(255,255,255,0.03));
    }
    .pf-ph__glyph {
      display: inline-flex; align-items: center; justify-content: center;
      width: 76px; height: 76px; border-radius: 20px; color: #c4b5fd;
      background: linear-gradient(135deg, rgba(168,85,247,.2), rgba(236,72,153,.1));
      border: 1px solid rgba(168,85,247,.28); margin-bottom: 4px;
    }
    .pf-ph__title { margin: 0; font-size: 19px; font-weight: 650; color: var(--text-primary, #f8fafc); }
    .pf-ph__sub { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--text-secondary, #cbd5e1); max-width: 460px; }
    .pf-ph__feats {
      margin-top: 14px; width: 100%; display: grid; gap: 8px;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    }
    .pf-ph__feat {
      display: flex; align-items: center; gap: 9px; text-align: left;
      padding: 11px 14px; border-radius: 11px;
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
    }
    .pf-ph__dot { width: 7px; height: 7px; border-radius: 50%; background: #a855f7; flex-shrink: 0; }
    .pf-ph__feat-label { font-size: 13px; font-weight: 500; color: var(--text-primary, #f1f5f9); }
  `],
})
export class ModulePlaceholderComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly _id = signal<string>(this.route.snapshot.data['moduleId'] ?? '');
  readonly mod = computed<ModuleDef | undefined>(() => moduleDef(this._id()) ?? MODULE_CATALOG[0]);
}
