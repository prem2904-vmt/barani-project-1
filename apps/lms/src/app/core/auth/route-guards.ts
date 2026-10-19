import { CanActivateFn } from '@angular/router';
import { permissionGuard } from './permission.guard';
import { routeAccess } from './route-access';
import { workflowGuardAny } from './workflow.guard';
import { moduleGuard } from './module.guard';

/**
 * The route guards for `path`, built from ROUTE_ACCESS (the same table the nav
 * reads) — the route's OWN level only; a guarded parent route supplies its own.
 * Throws at startup if the path isn't in the table, so a typo can't silently
 * produce an unguarded route.
 */
export function routeGuards(path: string): CanActivateFn[] {
  const acc = routeAccess(path);
  if (!acc) throw new Error(`routeGuards: no ROUTE_ACCESS entry for ${path}`);
  const guards: CanActivateFn[] = [];
  if (acc.perms?.length) guards.push(permissionGuard(acc.perms, acc.effective ? { effective: true } : undefined));
  if (acc.workflow?.length) guards.push(workflowGuardAny(...acc.workflow));
  if (acc.module) guards.push(moduleGuard(acc.module));
  return guards;
}
