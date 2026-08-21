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

async function loginWith(page: Page, c: { org: string; username: string; password: string }): Promise<void> {
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
export type RoleKey = 'receptionist' | 'sampleCollector' | 'labTech' | 'pathologist' | 'manager' | 'admin';

export const ROLE_CREDS: Record<RoleKey, { org: string; username: string; password: string; role: string }> = {
  receptionist:    { org: 'Micro World', username: 'priya@apollo.prefrontal',    password: 'Recep@123',    role: 'Receptionist' },
  sampleCollector: { org: 'Micro World', username: 'ravi@apollo.prefrontal',     password: 'Sample@123',   role: 'Sample Collector' },
  labTech:         { org: 'Micro World', username: 'muthu@apollo.prefrontal',    password: 'Lab@123',      role: 'Lab Technician' },
  pathologist:     { org: 'Micro World', username: 'drnithin@apollo.prefrontal', password: 'Path@123',     role: 'Pathologist' },
  manager:         { org: 'Micro World', username: 'karthik@apollo.prefrontal',  password: 'Manager@123',  role: 'Branch Manager' },
  admin:           { org: 'Micro World', username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123', role: 'Lab Admin' },
};

/** Log in as a specific seeded role. Each RBAC test gets a fresh context, so
 *  this cleanly signs in as exactly that role. */
export async function loginAs(page: Page, role: RoleKey): Promise<void> {
  await loginWith(page, ROLE_CREDS[role]);
}
