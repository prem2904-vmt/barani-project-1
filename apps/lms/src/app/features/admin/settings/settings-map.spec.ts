import {
  LEGACY_SECTION, SETTINGS_GROUPS, SETTINGS_PATHS as P, SETTINGS_SECTIONS, allSettingsPaths, categoryPath, locateSettings,
  categoriesFromPage, categoryTarget, rehome, rehomeHref, settingsParents, SETTINGS_FULL_SCREEN_PATHS,
} from './settings-map';
import { ROUTE_ACCESS } from '../../../core/auth/route-access';
import { SETTINGS_FULL_PAGE_ROUTES, SETTINGS_SHELL_CHILDREN } from './settings.routes';
import { CASESHEET_SHELL_ROUTES } from '../../casesheets/casesheets.routes';
import { OPD_ADMIN_ROUTES } from '../../opd/opd.routes';
import { SETTINGS_CATALOG, SETTINGS_PARENT } from '../../../shared/utils/settings-catalog';

describe('Settings map — the approved structure', () => {
  it('two groups, Departments then Organization, nothing shared and no "All departments"', () => {
    expect(SETTINGS_GROUPS.map((g) => g.heading)).toEqual(['Departments', 'Organization']);
    expect(SETTINGS_SECTIONS.map((s) => s.group)).not.toContain('all');
    expect(SETTINGS_SECTIONS.map((s) => s.label)).not.toContain('All departments');
    expect(JSON.stringify(SETTINGS_SECTIONS)).not.toMatch(/shared front desk/i);
  });

  it('Departments: Lab, OPD, Pharmacy, IPD, Inventory — then Organization in the approved order', () => {
    const dept = SETTINGS_SECTIONS.filter((s) => s.group === 'departments').map((s) => s.label);
    expect(dept).toEqual(['Lab', 'OPD', 'Pharmacy', 'IPD', 'Inventory']);
    const org = SETTINGS_SECTIONS.filter((s) => s.group === 'organization').map((s) => s.label);
    expect(org).toEqual(['Organization profile', 'Branches', 'Patient numbers', 'People and access',
      'Billing and taxes', 'Connected apps', 'Message channels', 'Files']);
  });

  it('OPD, Pharmacy and IPD only show when the lab has them; coming-soon departments are not listed', () => {
    const need = Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s.requires]));
    expect(need['opd']).toBe('opd');
    expect(need['pharmacy']).toBe('pharmacy');
    expect(need['ipd']).toBe('ipd');
    const labels = SETTINGS_SECTIONS.map((s) => s.label.toLowerCase());
    for (const soon of ['radiology', 'payroll', 'emergency', 'blood bank', 'insurance']) expect(labels).not.toContain(soon);
  });

  it('beta surfaces stay beta: Connected apps (mcp) and Files (neuron)', () => {
    const item = (id: string) => SETTINGS_SECTIONS.flatMap((s) => s.items).find((i) => i.id === id)!;
    expect(item('org-connected').beta).toBe('mcp');
    expect(item('org-files').beta).toBe('neuron');
  });

  it('the route map uses the EXACT approved paths', () => {
    const lab = SETTINGS_SECTIONS.find((s) => s.id === 'lab')!.items.map((i) => i.path);
    expect(lab).toEqual([
      '/admin/lab/departments', '/admin/lab/sample-numbers', '/admin/tests', '/admin/reports', '/admin/lab/collection',
      '/admin/lab/results', '/admin/lab/outsourcing', '/admin/lab/analyzers', '/admin/lab/front-desk', '/admin/lab/alerts',
      '/admin/lab/numbers', '/admin/lab/work-steps', '/admin/lab/home-collection',
    ]);
    const find = (id: string) => SETTINGS_SECTIONS.flatMap((s) => s.items).find((i) => i.id === id)!;
    expect(find('lab-outsourcing').categories.map((c) => c.path)).toEqual(['/admin/referral-labs', '/admin/partner-prices']);
    expect(find('lab-analyzers').categories.map((c) => c.path)).toEqual(['/admin/instruments', '/admin/bridges']);
    expect(find('lab-work-steps').categories.map((c) => c.path)).toEqual(['/admin/process', '/admin/workflows']);
    const paths = SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.path));
    for (const p of ['/admin/pharmacy', '/admin/pharmacy/drugs', '/admin/ipd/departments', '/admin/ipd/myprefrontal', '/admin/ipd/alerts',
      '/admin/inventory', '/admin/opd/front-desk', '/admin/org/profile', '/admin/branches', '/admin/org/numbers', '/admin/users',
      '/admin/billing', '/admin/ai-connectors', '/admin/org/channels', '/admin/files']) expect(paths).toContain(p);
  });

  it('ids are unique and every setting has a blurb, an icon and at least one category', () => {
    const ids = SETTINGS_SECTIONS.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SETTINGS_SECTIONS) for (const i of s.items) {
      expect(i.blurb.length, i.id).toBeGreaterThan(10);
      expect(i.iconPath, i.id).toBeTruthy();
      expect(i.categories.length, i.id).toBeGreaterThan(0);
    }
  });

  it('no emoji and no "AI" in the copy (Cortex only)', () => {
    const text = JSON.stringify(SETTINGS_SECTIONS.map((s) => [s.label, s.blurb, s.items.map((i) => [i.label, i.blurb, i.categories.map((c) => c.label)])]));
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/\bAI\b/);
  });
});

describe('Settings route table — one row per path, every path gated and hosted', () => {
  const hosted = new Set(SETTINGS_SHELL_CHILDREN.map((r) => '/' + (r.path ?? '')));
  const full = new Set(SETTINGS_FULL_PAGE_ROUTES.map((r) => '/' + (r.path ?? '')));
  const sheets = new Set(CASESHEET_SHELL_ROUTES.map((r) => '/' + (r.path ?? '')));
  const opd = new Set(OPD_ADMIN_ROUTES.map((r) => '/' + (r.path ?? '')));

  it('every path a setting or category answers on is routed (hosted card page or full-screen page — nothing 404s)', () => {
    for (const p of allSettingsPaths()) expect(hosted.has(p) || full.has(p) || sheets.has(p) || opd.has(p), p).toBe(true);
  });

  it('full-screen pages are never hosted; card-style pages always are (DESIGN-V2 rule 2)', () => {
    for (const p of SETTINGS_FULL_SCREEN_PATHS) expect(hosted.has(p), p).toBe(false);
    for (const p of ['/admin/lab/sample-numbers', '/admin/lab/collection', '/admin/org/profile', '/admin/billing']) expect(hosted.has(p), p).toBe(true);
    expect(full.has('/admin/tests')).toBe(true);
  });

  it('every hosted path has a ROUTE_ACCESS gate (or its own guards)', () => {
    for (const p of hosted) {
      const hasGate = !!ROUTE_ACCESS[p];
      const route = SETTINGS_SHELL_CHILDREN.find((r) => '/' + r.path === p)!;
      expect(hasGate || (route.canActivate?.length ?? 0) > 0, p).toBe(true);
    }
  });

  it('no path is routed twice', () => {
    const paths = SETTINGS_SHELL_CHILDREN.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('a category path resolves back to its own setting (no two settings claim one path)', () => {
    for (const s of SETTINGS_SECTIONS) for (const i of s.items) for (const c of i.categories) {
      const loc = locateSettings(categoryPath(i, c), c.query ?? {});
      expect(loc?.item.id, `${i.id}/${c.id}`).toBe(i.id);
      expect(loc?.category?.id, `${i.id}/${c.id}`).toBe(c.id);
    }
  });

  it('locate: a tabbed page picks the category the URL names, else the first', () => {
    expect(locateSettings('/admin/billing', { tab: 'payments' })?.category?.id).toBe('payments');
    expect(locateSettings('/admin/billing')?.category?.id).toBe('gst');
    expect(locateSettings('/admin/tests', { view: 'pricing' })?.category?.id).toBe('pricing');
    expect(locateSettings('/admin/lab/outsourcing')?.category).toBeNull();
    expect(locateSettings('/admin/lab/outsourcing')?.item.id).toBe('lab-outsourcing');
    expect(locateSettings('/nowhere')).toBeNull();
  });

  it('back from any settings page climbs to the overview on its section', () => {
    const parents = settingsParents();
    expect(parents['/admin/referral-labs']).toBe('/admin?section=lab');
    expect(parents['/admin/billing']).toBe('/admin?section=billing');
    expect(SETTINGS_PARENT['/admin/lab/departments']).toBe('/admin?section=lab');
    expect(SETTINGS_PARENT['/admin/ipd/departments']).toBe('/admin?section=ipd');
  });
});

describe('Old links keep working — they all land on a new home', () => {
  it('lab-settings tabs → the new Lab homes (LEGACY_LAB_SETTINGS_* owned by the Lab pages)', () => {
    expect(rehome('/admin/lab-settings', { tab: 'queues' })).toEqual({ path: P.labCollection, query: { tab: 'queue' } });
    expect(rehome('/admin/lab-settings', { tab: 'collection' })).toEqual({ path: P.labSampleNumbers, query: { tab: 'find' } });
    expect(rehome('/admin/lab-settings', { tab: 'rules' })).toEqual({ path: P.labResults, query: { tab: 'validation' } });
    expect(rehome('/admin/lab-settings', { tab: 'report' })).toEqual({ path: P.reports, query: { tab: 'table' } });
    // Report options are tabs of Report design now (one page, owner 2026-11-17).
    expect(rehome('/admin/lab/report-options', { tab: 'sending' })).toEqual({ path: P.reports, query: { tab: 'sending' } });
    // Report notes is a row of the Results table tab.
    expect(rehome('/admin/lab/report-options', { tab: 'notes' })).toEqual({ path: P.reports, query: { tab: 'table' } });
    expect(rehome('/admin/lab/report-options')).toEqual({ path: P.reports, query: { tab: 'table' } });
    expect(rehome('/admin/lab-settings', { tab: 'rules', card: 'calc-constants' })).toEqual({ path: P.labResults, query: { tab: 'constants' } });
    expect(rehome('/admin/lab-settings')?.path).toBe(P.labSampleNumbers);
  });

  it('organization tabs → profile / numbers / Lab sample numbers', () => {
    expect(rehome('/admin/organization', { tab: 'identity' })?.path).toBe(P.orgProfile);
    expect(rehome('/admin/organization', { tab: 'patient' })).toEqual({ path: P.orgNumbers, query: { tab: 'patient' } });
    // Order IDs per module: the old Order ID tab is the Lab's order number now (Lab › Sample numbers).
    expect(rehome('/admin/organization', { tab: 'order' })).toEqual({ path: P.labSampleNumbers, query: { tab: 'order' } });
    expect(rehome('/admin/organization', { tab: 'sample' })).toEqual({ path: P.labSampleNumbers, query: { tab: 'format' } });
  });

  it('every other moved path', () => {
    expect(rehome('/admin/communication', { tab: 'email' })).toEqual({ path: P.orgChannels, query: { tab: 'email' } });
    expect(rehome('/admin/appointments', { tab: 'slots' })).toEqual({ path: P.labFrontDesk, query: { tab: 'slots' } });
    expect(rehome('/admin/notifications')?.path).toBe(P.labAlerts);
    expect(rehome('/admin/kpis')?.path).toBe(P.labNumbers);
    expect(rehome('/admin/home-collection')?.path).toBe(P.labHomeCollection);
    expect(rehome('/admin/partners')?.path).toBe(P.labOutsourcing);
    expect(rehome('/admin/referring-network')).toEqual({ path: P.labFrontDesk, query: { tab: 'referring' } });
    expect(rehome('/admin/lab/front-desk/referring')).toEqual({ path: P.labFrontDesk, query: { tab: 'referring' } });
    expect(rehome('/admin/microbiology')).toEqual({ path: P.labResults, query: { tab: 'micro' } });
    expect(rehome('/setup')?.path).toBe(P.orgProfile);
    expect(rehome('/admin/org/profile/branding')?.path).toBe(P.orgProfile);
    expect(rehome('/admin/vendors')).toEqual({ path: P.billing, query: { tab: 'credit' } });
    expect(rehome('/admin/opd/pharmacy', { tab: 'drugs' })?.path).toBe(P.pharmacyDrugs);
    expect(rehome('/admin/opd/pharmacy')?.path).toBe(P.pharmacy);
    expect(rehome('/admin/opd/drugs')?.path).toBe(P.pharmacyDrugs);
    expect(rehome('/admin/tests')).toBeNull();
  });

  it('old overview / hub section ids map to a section that exists', () => {
    for (const to of Object.values(LEGACY_SECTION)) expect(SETTINGS_SECTIONS.some((s) => s.id === to), to).toBe(true);
    expect(LEGACY_SECTION['finance']).toBe('billing');
    expect(LEGACY_SECTION['communication']).toBe('channels');
    expect(LEGACY_SECTION['automation']).toBe('lab');
  });

  it('rehomeHref keeps a href that did not move', () => {
    expect(rehomeHref('/admin/tests')).toEqual({ href: '/admin/tests', queryParams: undefined });
    expect(rehomeHref('/admin/lab-settings?tab=rules')).toEqual({ href: P.labResults, queryParams: { tab: 'validation' } });
  });
});

describe('Settings catalog — search finds every setting at its new home', () => {
  it('every entry (except personal pages) points at a place in the map', () => {
    for (const e of SETTINGS_CATALOG) {
      if (e.href === '/printing') continue;
      expect(locateSettings(e.href, e.queryParams ?? {}), `${e.title} → ${e.href}`).not.toBeNull();
    }
  });

  it('no entry points at an old home, and Finance / Daily statement / Expenses / Audit trail / Modules / hubs are gone', () => {
    const hrefs = SETTINGS_CATALOG.map((e) => e.href);
    for (const old of ['/admin/lab-settings', '/admin/organization', '/admin/communication', '/admin/appointments', '/admin/notifications',
      '/admin/kpis', '/admin/partners', '/admin/manage', '/lab/settings', '/admin/modules', '/setup', '/finance', '/finance/daily', '/expenses', '/admin/audit']) {
      expect(hrefs, old).not.toContain(old);
    }
    const titles = SETTINGS_CATALOG.map((e) => e.title);
    for (const gone of ['Finance', 'Daily Statement', 'Expenses', 'Audit trail', 'Modules', 'Settings hub', 'Lab']) expect(titles).not.toContain(gone);
  });

  it('the section label under a hit names where it lives now', () => {
    const e = SETTINGS_CATALOG.find((x) => x.title === 'Queue focus')!;
    expect(e.href).toBe(P.labCollection);
    expect(e.section).toContain('Lab');
    expect(e.section).toContain('Collection and queues');
  });
});

describe('Categories from a page list (the Lab pages\' LAB_PAGES shape)', () => {
  it('each id becomes a category on the page path with ?tab=<id>', () => {
    const cats = categoriesFromPage({ path: '/admin/lab/results', categories: [{ id: 'validation', label: 'Validation' }, { id: 'micro', label: 'Microbiology' }] });
    expect(cats).toEqual([
      { id: 'validation', label: 'Validation', path: '/admin/lab/results', query: { tab: 'validation' } },
      { id: 'micro', label: 'Microbiology', path: '/admin/lab/results', query: { tab: 'micro' } },
    ]);
  });

  it('Report design lists its tabs, ending with Footer and Sending (Report notes is a row of Results table)', () => {
    const rd = SETTINGS_SECTIONS.flatMap((s) => s.items).find((i) => i.id === 'lab-report')!;
    expect(rd.categories.slice(-2).map((c) => c.query?.['tab'])).toEqual(['footer', 'sending']);
    expect(categoryTarget(rd, rd.categories.at(-1)!).path).toBe('/admin/reports');
    expect(rd.categories.some((c) => c.query?.['tab'] === 'notes')).toBe(false);
  });
});
