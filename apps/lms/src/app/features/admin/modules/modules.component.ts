import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandMatch } from '../../../shared/utils/band-search';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { OpdGateService } from '../../opd/shared/opd-gate.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { MODULE_CATALOG, ModuleDef, ModulesState } from '../../../core/modules/module-catalog';

/**
 * Admin → Modules (Extensions). Two-level enablement: each product module has a
 * master toggle, and inside an enabled module its features toggle individually.
 * Turning a module off hides its nav + blocks its routes tenant-wide; turning a
 * placeholder module on lights up its (coming-soon) shell. Persists to
 * /api/tenants/modules via TenantEntitlementsService.
 */
@Component({
  selector: 'pf-admin-modules',
  standalone: true,
  imports: [ScreenHeaderComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): search modules + their features; On/Off filter
             in the pill. Toggles save live, so there are no band actions. -->
        <pf-hero-band [back]="true" placeholder="Search modules & features — OPD, pharmacy, inventory…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            <!-- Neutral kit segment (counts in Noto tabular, never mono). -->
            <span class="pf-seg pf-mods-seg" role="radiogroup" aria-label="Show modules">
              @for (o of statusOptions(); track o.value) {
                <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="status() === o.value"
                        (click)="status.set(o.value)">{{ o.label }} <span class="pf-num pf-mods-seg__n">{{ o.count }}</span></button>
              }
            </span>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Platform"
        title="Modules"
        subtitle="Turn product modules on or off, and choose which features run inside each. Changes apply across the tenant.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="pf-mods">
        @for (m of visibleCatalog(); track m.id) {
          <div class="pf-mod pf-card" [class.pf-mod--on]="isModuleOn(m.id)">
            <div class="pf-mod__head">
              <span class="pf-card__icon pf-mod__icon" [style.opacity]="isModuleOn(m.id) ? 1 : 0.5">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path [attr.d]="m.iconPath"></path>
                </svg>
              </span>
              <div class="pf-mod__meta">
                <div class="pf-mod__titlerow">
                  <h3 class="pf-mod__title">{{ m.label }}</h3>
                  @if (m.status === 'coming_soon') { <span class="pf-chip pf-chip--static pf-mod__badge">Coming soon</span> }
                </div>
                <p class="pf-mod__blurb">{{ m.blurb }}</p>
              </div>
              <button type="button" class="pf-toggle pf-tog" role="switch" [attr.aria-checked]="isModuleOn(m.id)"
                      [attr.aria-label]="'Enable ' + m.label" [disabled]="busy()" (click)="toggleModule(m.id)">
                <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
              </button>
            </div>

            @if (isModuleOn(m.id) && m.features.length) {
              <div class="pf-mod__feats">
                @for (f of m.features; track f.key) {
                  <div class="pf-feat">
                    <div class="pf-feat__meta">
                      <span class="pf-feat__label">{{ f.label }}</span>
                      @if (f.hint) { <span class="pf-feat__hint">{{ f.hint }}</span> }
                    </div>
                    <button type="button" class="pf-toggle pf-tog" role="switch" [attr.aria-checked]="isFeatureOn(m.id, f.key)"
                            [attr.aria-label]="'Enable ' + f.label" [disabled]="busy()" (click)="toggleFeature(m.id, f.key)">
                      <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
      @if (!visibleCatalog().length) {
        <p class="pf-band-empty">No modules match{{ q().trim() ? ' "' + q() + '"' : '' }}.</p>
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-mods-seg { flex: none; }
    .pf-mods-seg .pf-seg__item { height: 32px; }
    .pf-mods-seg__n { color: var(--text-tertiary); font-weight: 500; margin-left: 2px; }
    .pf-mods { display: flex; flex-direction: column; gap: 14px; max-width: 760px; margin-inline: auto; }
    .pf-mod { transition: border-color var(--pf-dur-fast) ease; }
    .pf-mod--on { border-color: var(--pf-sel-border); }
    .pf-mod__head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; }
    .pf-mod__icon { width: 36px; height: 36px; border-radius: 10px; }
    .pf-mod__meta { flex: 1; min-width: 0; }
    .pf-mod__titlerow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-mod__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-mod__badge { height: 22px; font-size: 11px; }
    .pf-mod__blurb { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .pf-mod__feats {
      border-top: 1px solid var(--pf-line);
      padding: 6px 18px 10px 66px; display: flex; flex-direction: column;
    }
    .pf-feat { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; }
    .pf-feat + .pf-feat { border-top: 1px solid var(--pf-line); }
    .pf-feat__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-feat__label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .pf-feat__hint { font-size: 12px; color: var(--text-tertiary); }
    .pf-tog { flex: none; margin-top: 6px; }
    .pf-feat .pf-tog { margin-top: 0; }
    /* Touch: a real 44px box around the slate switch. */
    @media (pointer: coarse) { .pf-tog { min-height: 44px; min-width: 44px; justify-content: center; } }
    @media (max-width: 640px) { .pf-mod__feats { padding-left: 18px; } }
`],
})
export class AdminModulesComponent implements OnInit {
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly toasts = inject(ToastService);
  private readonly opdGate = inject(OpdGateService);

  /** OPD dark build: OPD is not listed (and so cannot be toggled) unless the
   *  OPD gate is open — the server also ignores an opd change from anyone who
   *  is not OPD-allowed. */
  readonly catalog: ModuleDef[] = MODULE_CATALOG.filter(m => m.id !== 'opd' || this.opdGate.visible());
  private readonly state = signal<ModulesState>({});
  readonly busy = signal(false);

  protected readonly theme = inject(ThemeService);
  /** Band pill search: a module matches on its own label/blurb or any feature's. */
  readonly q = signal('');
  readonly status = signal<'all' | 'on' | 'off'>('all');
  readonly statusOptions = computed<SegmentedOption<'all' | 'on' | 'off'>[]>(() => {
    const on = this.catalog.filter(m => this.isModuleOn(m.id)).length;
    return [
      { value: 'all', label: 'All', count: this.catalog.length },
      { value: 'on', label: 'On', count: on },
      { value: 'off', label: 'Off', count: this.catalog.length - on },
    ];
  });
  readonly visibleCatalog = computed(() => {
    const q = this.q();
    const st = this.status();
    this.state(); // re-filter when a toggle flips (On/Off chips)
    return this.catalog.filter(m => {
      if (st === 'on' && !this.isModuleOn(m.id)) return false;
      if (st === 'off' && this.isModuleOn(m.id)) return false;
      return bandMatch(q, m.label, m.blurb) || m.features.some(f => bandMatch(q, f.label, f.hint));
    });
  });

  async ngOnInit(): Promise<void> {
    await this.entitlements.ensureLoaded();
    this.state.set(this.entitlements.effectiveState());
  }

  isModuleOn(id: string): boolean { return this.state()[id]?.enabled ?? false; }
  isFeatureOn(id: string, key: string): boolean {
    return this.isModuleOn(id) && this.state()[id]?.features?.[key] !== false;
  }

  toggleModule(id: string): void {
    const s = this.clone();
    s[id] = { ...s[id], enabled: !(s[id]?.enabled ?? false) };
    this.persist(s);
  }

  toggleFeature(id: string, key: string): void {
    const s = this.clone();
    const feats = { ...(s[id]?.features ?? {}) };
    feats[key] = feats[key] === false;   // flip (undefined/true → off, false → on)
    s[id] = { ...s[id], enabled: s[id]?.enabled ?? false, features: feats };
    this.persist(s);
  }

  private clone(): ModulesState {
    return JSON.parse(JSON.stringify(this.state())) as ModulesState;
  }

  private persist(next: ModulesState): void {
    const prev = this.state();
    this.state.set(next);           // optimistic
    this.busy.set(true);
    this.entitlements.save(next).subscribe({
      next: () => { this.busy.set(false); this.toasts.success('Modules updated'); },
      error: (e) => {
        this.state.set(prev);       // revert on failure
        this.busy.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }
}
