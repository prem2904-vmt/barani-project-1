import { Injector, Signal, computed, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { brandingSrc } from '../../../core/services/uploads.service';

/**
 * The lab's own mark, as every band shows it (ONE resolution, used by `pf-hero-band` and by a screen that projects its
 * own brand button through `[band-brand]`, e.g. the case sheet's hold-for-a-voice-note mark): the admin-uploaded logo
 * when branding allows it, the initial disc otherwise; the name honours brandingName + mode. A personal case-sheet
 * space shows the doctor, never its internal "Personal space …" name. Call in an injection context.
 */
export interface TenantBrand {
  readonly name: Signal<string>;
  readonly brandingName: Signal<string | null>;
  /** A private "/uploads/…" logo shows through the session (blob: URL); null while it loads or when there is none. */
  readonly logo: Signal<string | null>;
  readonly showLogo: Signal<boolean>;
  readonly showName: Signal<boolean>;
  readonly initial: Signal<string>;
}

export function injectTenantBrand(): TenantBrand {
  const auth = inject(AuthService);
  const tenantState = inject(TenantStateService);
  const injector = inject(Injector);
  const name = computed(() => {
    const u = auth.user();
    if (u?.tenantKind === 'personal') return u.displayName?.trim() || 'My case sheets';
    return tenantState.tenant()?.name || u?.tenantName || 'Your organization';
  });
  const mode = computed(() => tenantState.tenant()?.brandingMode ?? 'both');
  const brandingName = computed(() => tenantState.tenant()?.brandingName?.trim() || null);
  return {
    name,
    brandingName,
    logo: computed(() => brandingSrc(injector, tenantState.tenant()?.logoUrl)),
    showLogo: computed(() => mode() === 'logo' || mode() === 'both'),
    showName: computed(() => mode() === 'name' || mode() === 'both'),
    initial: computed(() => ((brandingName() || name()).trim()[0] ?? 'P').toUpperCase()),
  };
}
