import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';

/**
 * The dedicated support tenant's name (remote-support contract, owner action 2:
 * Admin console → tenant "Prefrontal Support").
 */
export const SUPPORT_TENANT_NAME = 'Prefrontal Support';

/** "Prefrontal Support" (any case, spaces trimmed) — and nothing else. */
export function isSupportTenantName(name: unknown): boolean {
  return typeof name === 'string' && name.trim().replace(/\s+/g, ' ').toLowerCase() === SUPPORT_TENANT_NAME.toLowerCase();
}

/** What Prefrontal Support's connector can do (consent wording). */
export const SUPPORT_CAN_DO: readonly string[] = [
  'Join a support session a lab starts on its PC, with the code the lab reads out',
  'Look at that PC’s network, firewall and analyzer connections during the session',
  'Ask to change an analyzer connection or open a firewall port — the lab allows or denies each change on the PC',
];

/**
 * Is the signed-in person in the Prefrontal Support tenant? WORDING ONLY
 * (beta `support`): the server has no "who am I" endpoint — /support-mcp
 * itself checks Support:TenantId + Support:AllowedEmails + Google on every
 * call, and /mcp still enforces the lab's AI-connector switch server-side —
 * so the consent page only uses this to say "Prefrontal Support access"
 * and not to ask for the support tenant's own AI-connector switch.
 * Beta off / no session / any other tenant ⇒ false (the normal consent).
 */
@Injectable({ providedIn: 'root' })
export class SupportWhoami {
  private readonly beta = inject(BetaFeaturesService);
  private readonly auth = inject(AuthService);

  async isSupport(): Promise<boolean> {
    try {
      await this.beta.ensureLoaded();
      if (!this.beta.enabled('support')) return false;
      return isSupportTenantName(this.auth.user()?.tenantName);
    } catch {
      return false;
    }
  }
}
