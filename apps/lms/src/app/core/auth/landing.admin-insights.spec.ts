import { describe, expect, it } from 'vitest';
import { pickLanding } from './landing.guard';

// Owner 2026-11-19: the admin home is Insights › Overview › This month (/insights defaults to both).
describe('landing — admin home is Insights', () => {
  const admin = (perms: string[], reportsModule = true) => ({
    hasAny: (p: readonly string[]) => p.some(x => perms.includes(x)),
    hasAnyEffective: (p: readonly string[]) => p.some(x => perms.includes(x)),
    isEnabled: () => true,
    moduleEnabled: (m: string) => (m === 'reports' ? reportsModule : true),
  });

  it('an admin who can open Insights lands on /insights', () => {
    expect(pickLanding(admin(['manage_tests', 'manage_users', 'view_analytics']))).toBe('/insights');
  });

  it('falls back to Settings (/admin) when the tenant has no Insights (reports module off)', () => {
    expect(pickLanding(admin(['manage_tests', 'manage_users', 'view_analytics'], false))).toBe('/admin');
  });

  it('falls back to Settings (/admin) when the admin has no analytics permission', () => {
    expect(pickLanding(admin(['manage_tests', 'manage_users']))).toBe('/admin');
  });

  it('non-admins keep their own landing (front desk with analytics still lands on /frontdesk)', () => {
    expect(pickLanding(admin(['register_patient', 'view_analytics']))).toBe('/frontdesk');
  });
});
