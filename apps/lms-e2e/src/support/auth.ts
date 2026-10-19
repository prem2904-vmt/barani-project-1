import { test, type Page } from '@playwright/test';

/**
 * LMS auth helper. Unlike Cortex (Google OAuth), the LMS login is
 * organization + username + password, so it IS automatable — no captured
 * session needed. Creds come from env so nothing secret lives in the repo:
 *   E2E_ORG, E2E_USERNAME, E2E_PASSWORD
 * pointing at a SEEDED TEST organization on the mw backend (:5270). Never use
 * real patient-facing credentials.
 */

export const creds = () => ({
  org: process.env.E2E_ORG ?? '',
  username: process.env.E2E_USERNAME ?? '',
  password: process.env.E2E_PASSWORD ?? '',
});

export const hasCreds = (): boolean => {
  const c = creds();
  return !!(c.org && c.username && c.password);
};

/** Skip an authed spec (with a clear reason) when creds/backend aren't wired. */
export function requireCreds(): void {
  test.skip(!hasCreds(), 'No E2E creds — set E2E_ORG/E2E_USERNAME/E2E_PASSWORD + run mw on :5270 (see apps/lms-e2e/README.md).');
}

/** Drive the real login form and wait until the app leaves /login. */
export async function login(page: Page): Promise<void> {
  const c = creds();
  await loginWith(page, { org: c.org, username: c.username, password: c.password });
}

export async function loginWith(page: Page, c: { org: string; username: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder(/your organization name/i).fill(c.org);
  await page.getByPlaceholder(/your username/i).fill(c.username);
  await page.getByPlaceholder('••••••••').fill(c.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 });
}

// ── Multi-role RBAC ──────────────────────────────────────────────────────
// The SEEDED Micro World demo staff (public fixtures in prefrontal-mw's
// DemoFlowSeeder — NOT secrets). Org is the tenant NAME 'Micro World'. Each
// role's mw permission set (RoleSeeder.cs) is the expected-access matrix RBAC
// specs assert against.
export type RoleKey =
  | 'receptionist' | 'billingCounter' | 'sampleCollector' | 'labTech' | 'homeCollection'
  | 'pathologist' | 'manager' | 'storeKeeper' | 'inventoryManager' | 'admin';

// Two provenances:
//  - Demo staff seeded by DemoFlowSeeder (email-style login handle, live Supabase acct).
//  - E2E users created via POST /api/users (username handle, password E2ePass1234) for
//    the roles the demo seeder never provisioned a working Supabase login for. Created
//    once by scratchpad/create-role-users.mjs; idempotent (409 username_exists on re-run).
//    priya (demo Receptionist) has no Supabase account → replaced by recepe2e.
export const ROLE_CREDS: Record<RoleKey, { org: string; username: string; password: string; role: string }> = {
  receptionist:     { org: 'Micro World', username: 'recepe2e',                  password: 'E2ePass1234',  role: 'Receptionist' },
  billingCounter:   { org: 'Micro World', username: 'billinge2e',                password: 'E2ePass1234',  role: 'Billing Counter' },
  sampleCollector:  { org: 'Micro World', username: 'ravi@apollo.prefrontal',    password: 'Sample@123',   role: 'Sample Collector' },
  labTech:          { org: 'Micro World', username: 'muthu@apollo.prefrontal',   password: 'Lab@123',      role: 'Lab Technician' },
  homeCollection:   { org: 'Micro World', username: 'homecolle2e',               password: 'E2ePass1234',  role: 'Home Collection Agent' },
  pathologist:      { org: 'Micro World', username: 'drnithin@apollo.prefrontal', password: 'Path@123',    role: 'Pathologist' },
  manager:          { org: 'Micro World', username: 'karthik@apollo.prefrontal', password: 'Manager@123',  role: 'Branch Manager' },
  storeKeeper:      { org: 'Micro World', username: 'storekpre2e',               password: 'E2ePass1234',  role: 'Store Keeper' },
  inventoryManager: { org: 'Micro World', username: 'invmgre2e',                 password: 'E2ePass1234',  role: 'Inventory Manager' },
  admin:            { org: 'Micro World', username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123', role: 'Lab Admin' },
};

/** Log in as a specific seeded role. Each RBAC test gets a fresh context, so
 *  this cleanly signs in as exactly that role. */
export async function loginAs(page: Page, role: RoleKey): Promise<void> {
  await loginWith(page, ROLE_CREDS[role]);
}
