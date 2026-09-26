import { SettingDef, SettingsTool } from './settings.model';

/** Perms that open the admin config pages today (app.routes ADMIN_PERMS):
 *  /setup (branding), /admin/modules, /admin/opd/*, /admin/kpis. */
export const ADMIN_PERMS = ['manage_tests', 'manage_users', 'manage_workflows'] as const;

/** Settings is for anyone holding ANY manage_* permission (owner). Each row
 *  is still gated by its own page's permission. */
export function hasAnyManage(perms: readonly string[] | null | undefined): boolean {
  const p = perms ?? [];
  return p.includes('*') || p.some((c) => c.startsWith('manage_'));
}

export function hasAny(perms: readonly string[], required: readonly string[]): boolean {
  if (!required.length) return true;
  if (perms.includes('*')) return true;
  return required.some((c) => perms.includes(c));
}

export interface AccessContext {
  perms: readonly string[];
  moduleOn: (key: NonNullable<SettingDef['module']>) => boolean;
}

/** Permission + module gate (value-dependent `visibleWhen` is separate). */
export function canSee(def: Pick<SettingDef, 'permission' | 'module'> | SettingsTool, ctx: AccessContext): boolean {
  if (!hasAny(ctx.perms, def.permission)) return false;
  if (def.module && !ctx.moduleOn(def.module)) return false;
  return true;
}
