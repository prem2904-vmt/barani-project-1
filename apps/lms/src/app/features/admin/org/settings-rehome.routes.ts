import { Routes } from '@angular/router';
import { permissionGuard } from '../../../core/auth/permission.guard';
import { ADMIN_PERMS } from '../../../core/auth/route-access';
import { routeGuards } from '../../../core/auth/route-guards';
import { casesheetGuard } from '../../casesheets/shared/casesheet.guard';
import { opdGuard } from '../../opd/shared/opd.guard';
import { PHARMACY_VIEW } from '../../opd/pharmacy/pharmacy-view';

/**
 * Settings re-home (owner 2026-11-17): the routed pages of Organization (profile, numbers, channels, billing), the
 * Finance credit-accounts money page, and the OPD / IPD / Pharmacy per-department pages. Children of the signed-in
 * shell (app.routes.ts spreads them once). Each page is an EXISTING screen reused, or a thin host of existing screens;
 * the `?tab=` anchors the Settings left panel lists are exported next to each host
 * (OPD_FRONT_DESK_SECTIONS, BILLING_SECTIONS).
 *
 *   /admin/org/profile            Organization profile — name, short name, logo, login handle (set once)
 *   /admin/org/numbers            Patient and order numbers (`?tab=patient|order`)
 *   /admin/org/channels           Message channels (`?tab=whatsapp|email|sms`)
 *   /admin/billing                Billing and taxes (`?tab=gst|invoice|payments|credit`)
 *   /finance/credit-accounts      Credit accounts: top up, record a payment, email a statement, history
 *   /admin/opd/front-desk         OPD front desk, alerts and numbers (`?tab=appointments|referring|alerts`) — in OPD_ADMIN_ROUTES (opd.routes.ts)
 *   /admin/ipd/alerts             IPD alerts
 *   /admin/pharmacy               Pharmacy settings (was /admin/opd/pharmacy, which redirects here)
 *   /admin/pharmacy/drugs         Drug master (was /admin/opd/drugs, which forwards here)
 */
const adminGuard = permissionGuard(ADMIN_PERMS);

export const SETTINGS_REHOME_ROUTES: Routes = [
  {
    path: 'admin/org/profile',
    canActivate: [...routeGuards('/admin/org/profile')],
    loadComponent: () => import('./org-profile.page').then(m => m.OrgProfilePage),
  },
  {
    path: 'admin/org/numbers',
    canActivate: [...routeGuards('/admin/org/numbers')],
    data: { orgTabs: ['patient', 'order'] },
    loadComponent: () => import('../organization/organization-settings.component').then(m => m.OrganizationSettingsComponent),
  },
  {
    path: 'admin/org/channels',
    canActivate: [...routeGuards('/admin/org/channels')],
    loadComponent: () => import('../communication/communication-settings.page').then(m => m.CommunicationSettingsPage),
  },
  {
    path: 'finance/credit-accounts',
    canActivate: [...routeGuards('/finance/credit-accounts')],
    data: { creditView: 'money' },
    loadComponent: () => import('../vendors/vendors.component').then(m => m.VendorsComponent),
  },
  {
    path: 'admin/ipd/alerts',
    canActivate: [casesheetGuard, ...routeGuards('/admin/ipd/alerts')],
    data: { department: 'ipd' },
    loadComponent: () => import('../notifications-config/notifications-config.component').then(m => m.NotificationsConfigComponent),
  },
  {
    path: 'admin/pharmacy',
    canActivate: [adminGuard, opdGuard],
    data: { moduleId: 'pharmacy', [PHARMACY_VIEW]: 'settings' },
    loadComponent: () => import('../../opd/pharmacy/pharmacy-settings.page').then(m => m.PharmacySettingsPage),
  },
  {
    path: 'admin/pharmacy/drugs',
    canActivate: [adminGuard, opdGuard],
    data: { moduleId: 'pharmacy', [PHARMACY_VIEW]: 'drugs' },
    loadComponent: () => import('../../opd/pharmacy/pharmacy-settings.page').then(m => m.PharmacySettingsPage),
  },
];
