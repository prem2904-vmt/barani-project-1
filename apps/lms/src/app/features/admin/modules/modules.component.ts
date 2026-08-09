import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
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
  imports: [ScreenHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Platform"
        title="Modules"
        subtitle="Turn product modules on or off, and choose which features run inside each. Changes apply across the tenant.">
      </pf-screen-header>

      <div class="pf-mods">
        @for (m of catalog; track m.id) {
          <div class="pf-mod" [class.pf-mod--on]="isModuleOn(m.id)">
            <div class="pf-mod__head">
              <span class="pf-mod__icon" [style.opacity]="isModuleOn(m.id) ? 1 : 0.5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path [attr.d]="m.iconPath"></path>
                </svg>
              </span>
              <div class="pf-mod__meta">
                <div class="pf-mod__titlerow">
                  <h3 class="pf-mod__title">{{ m.label }}</h3>
                  @if (m.status === 'coming_soon') { <span class="pf-mod__badge">Coming soon</span> }
                </div>
                <p class="pf-mod__blurb">{{ m.blurb }}</p>
              </div>
              <label class="pf-tog" [class.pf-tog--on]="isModuleOn(m.id)" [attr.aria-label]="'Enable ' + m.label">
                <input type="checkbox" [checked]="isModuleOn(m.id)"
                       [disabled]="busy()"
                       (change)="toggleModule(m.id)" />
                <span class="pf-tog__track"><span class="pf-tog__thumb"></span></span>
              </label>
            </div>

            @if (isModuleOn(m.id) && m.features.length) {
              <div class="pf-mod__feats">
                @for (f of m.features; track f.key) {
                  <div class="pf-feat">
                    <div class="pf-feat__meta">
                      <span class="pf-feat__label">{{ f.label }}</span>
                      @if (f.hint) { <span class="pf-feat__hint">{{ f.hint }}</span> }
                    </div>
                    <label class="pf-tog pf-tog--sm" [class.pf-tog--on]="isFeatureOn(m.id, f.key)"
                           [attr.aria-label]="'Enable ' + f.label">
                      <input type="checkbox" [checked]="isFeatureOn(m.id, f.key)"
                             [disabled]="busy()"
                             (change)="toggleFeature(m.id, f.key)" />
                      <span class="pf-tog__track"><span class="pf-tog__thumb"></span></span>
                    </label>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .pf-mods { display: flex; flex-direction: column; gap: 14px; max-width: 760px; }
    .pf-mod {
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      border-radius: 16px; background: var(--bg-card, rgba(255,255,255,0.03));
      overflow: hidden; transition: border-color .15s;
    }
    .pf-mod--on { border-color: rgba(16,185,129,.35); }
    .pf-mod__head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; }
    .pf-mod__icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
      color: #c4b5fd; background: rgba(168,85,247,.14); border: 1px solid rgba(168,85,247,.22);
    }
    .pf-mod__meta { flex: 1; min-width: 0; }
    .pf-mod__titlerow { display: flex; align-items: center; gap: 8px; }
    .pf-mod__title { margin: 0; font-size: 15px; font-weight: 650; color: var(--text-primary, #f8fafc); }
    .pf-mod__badge {
      font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
      color: #fbbf24; background: rgba(251,191,36,.12); border: 1px solid rgba(251,191,36,.28);
      padding: 2px 7px; border-radius: 999px;
    }
    .pf-mod__blurb { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary, #cbd5e1); }
    .pf-mod__feats {
      border-top: 1px solid var(--glass-border, rgba(255,255,255,0.08));
      padding: 6px 18px 10px 68px; display: flex; flex-direction: column;
    }
    .pf-feat { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; }
    .pf-feat + .pf-feat { border-top: 1px solid rgba(255,255,255,0.05); }
    .pf-feat__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-feat__label { font-size: 13px; font-weight: 500; color: var(--text-primary, #f1f5f9); }
    .pf-feat__hint { font-size: 11.5px; color: var(--text-muted, #94a3b8); }

    /* Toggle (self-contained; mirrors the lab-settings switch). */
    .pf-tog { position: relative; display: inline-flex; flex-shrink: 0; cursor: pointer; }
    .pf-tog input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
    .pf-tog input:disabled { cursor: not-allowed; }
    .pf-tog__track {
      width: 42px; height: 24px; border-radius: 12px; background: rgba(255,255,255,0.14);
      transition: background .15s; display: inline-flex; align-items: center; padding: 2px;
    }
    .pf-tog__thumb {
      width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s;
    }
    .pf-tog--on .pf-tog__track { background: #10b981; }
    .pf-tog--on .pf-tog__thumb { transform: translateX(18px); }
    .pf-tog--sm .pf-tog__track { width: 36px; height: 21px; }
    .pf-tog--sm .pf-tog__thumb { width: 17px; height: 17px; }
    .pf-tog--sm.pf-tog--on .pf-tog__thumb { transform: translateX(15px); }
  
    /* Touch: the pf-tog switches are ~24px tall and exempt from the global
       44px button floor (they're labels) — give them a real touch box. */
    @media (pointer: coarse) {
      .pf-tog { min-height: 44px; align-items: center; }
    }
    @media (max-width: 640px) {
      .pf-mod__feats { padding-left: 18px; }
    }
`],
})
export class AdminModulesComponent implements OnInit {
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly toasts = inject(ToastService);

  readonly catalog: ModuleDef[] = MODULE_CATALOG;
  private readonly state = signal<ModulesState>({});
  readonly busy = signal(false);

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
