import { COMMS_SETTINGS_PERMS, FILES_SETTINGS_PERMS, ROUTE_ACCESS, canOpenRoute } from '../../core/auth/route-access';
import { SETTINGS_CATALOG, SETTINGS_PARENT, SETTINGS_SECTION, settingsKeywordsFor } from './settings-catalog';

const ctx = (perms: string[], moduleOn = true) => ({ hasAny: (p: string[]) => perms.some(x => p.includes(x)), isEnabled: () => true, moduleEnabled: () => moduleOn });

describe('Settings → All departments: Communication and Files', () => {
  it('Communication is listed under All departments, still found by search, and its parent is the Settings overview', () => {
    const page = SETTINGS_CATALOG.find(e => e.href === '/admin/communication' && e.kind === 'page')!;
    expect(page.section).toBe(SETTINGS_SECTION.allDepartments);
    expect(SETTINGS_SECTION.allDepartments).toBe('All departments');
    expect(page.keywords).toEqual(expect.arrayContaining(['whatsapp', 'email', 'sms']));
    expect(SETTINGS_PARENT['/admin/communication']).toBe('/admin?section=communication');
    expect(SETTINGS_CATALOG.some(e => e.href === '/admin/communication' && e.title === 'Send a test email')).toBe(true);
  });

  it('OPD, IPD and Pharmacy admins without lab permissions can open Communication; a role with none of them cannot', () => {
    for (const p of ['manage_opd', 'manage_ipd', 'manage_pharmacy', 'manage_lab_settings', 'manage_notifications'])
      expect(canOpenRoute('/admin/communication', ctx([p])), p).toBe(true);
    expect(canOpenRoute('/admin/communication', ctx(['view_report', 'create_order']))).toBe(false);
    expect(COMMS_SETTINGS_PERMS).toEqual(expect.arrayContaining(['manage_opd', 'manage_ipd', 'manage_pharmacy']));
  });

  it('Files is an ordinary page in the catalog: beta neuron, settings admins only, with its cards searchable', () => {
    const page = SETTINGS_CATALOG.find(e => e.href === '/admin/files' && e.kind === 'page')!;
    expect(page.title).toBe('Files');
    expect(page.section).toBe('All departments');
    expect(page.beta).toBe('neuron');
    expect(page.perms).toEqual(FILES_SETTINGS_PERMS);
    expect(page.keywords).toEqual(expect.arrayContaining(['neuron', 'synapse', 'axon', 'myelin', 'retina', 'office', 'storage', 'trash']));
    const cards = SETTINGS_CATALOG.filter(e => e.href === '/admin/files' && e.kind === 'setting');
    expect(cards.map(c => c.title)).toEqual(expect.arrayContaining(['Apps on or off, who can edit', 'Templates on File → New', 'Storage used', 'Edit on phones', 'Deleted files kept in Trash', 'Patient names in files', 'On the bottom bar by default']));
    for (const c of cards) { expect(c.beta).toBe('neuron'); expect(c.perms).toEqual(FILES_SETTINGS_PERMS); }
    expect(SETTINGS_PARENT['/admin/files']).toBe('/admin?section=files');
    expect(settingsKeywordsFor('/admin/files')).toEqual(expect.arrayContaining(['Storage used', 'office']));
  });

  it('only the tenant admin opens Settings → Files', () => {
    expect(ROUTE_ACCESS['/admin/files']?.perms).toEqual(['manage_tenant']);
    expect(canOpenRoute('/admin/files', ctx(['manage_tenant']))).toBe(true);
    expect(canOpenRoute('/admin/files', ctx(['manage_lab_settings', 'manage_users', 'manage_tests']))).toBe(false);
  });

  it('no product word of the engines\' origin and no suite name appears in the Files catalog entries', () => {
    const text = JSON.stringify(SETTINGS_CATALOG.filter(e => e.href === '/admin/files'));
    expect(text).not.toMatch(/gridcraft|wordcraft|deckcraft|pdfcraft|artcraft|storytold|prefrontal office/i);
  });
});
