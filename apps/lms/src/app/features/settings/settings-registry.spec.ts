import { SETTINGS, SETTINGS_GROUPS, SETTINGS_TOOLS, rowsOfGroup } from './settings-registry';
import { hasAnyManage, canSee } from './settings-access';
import { matchTool, queryWords, searchRows } from './settings-search';

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));

describe('Settings registry', () => {
  it('every row has an id, a known group, a 2–6 word label, a store, a key and a permission list', () => {
    const ids = new Set<string>();
    for (const d of SETTINGS) {
      expect(d.id, 'id').toBeTruthy();
      expect(ids.has(d.id), `duplicate id ${d.id}`).toBe(false);
      ids.add(d.id);
      expect(groupIds.has(d.group), `${d.id} group`).toBe(true);
      expect(words(d.label), `${d.id} label "${d.label}"`).toBeGreaterThanOrEqual(2);
      expect(words(d.label), `${d.id} label "${d.label}"`).toBeLessThanOrEqual(6);
      expect(d.adapter, `${d.id} adapter`).toBeTruthy();
      expect(d.key, `${d.id} key`).toBeTruthy();
      expect(Array.isArray(d.permission), `${d.id} permission`).toBe(true);
    }
  });

  it('only "This device" / "Only me" rows may skip a permission', () => {
    for (const d of SETTINGS) {
      if (d.scope === 'device' || d.scope === 'user') continue;
      expect(d.permission.length, `${d.id} needs a permission`).toBeGreaterThan(0);
    }
  });

  it('one-liners are 12 words or fewer; no emoji anywhere', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const d of SETTINGS) {
      if (d.help) expect(words(d.help), `${d.id} help "${d.help}"`).toBeLessThanOrEqual(12);
      expect(emoji.test(d.label + (d.help ?? '')), d.id).toBe(false);
      for (const o of d.control.options ?? []) expect(emoji.test(o.label), `${d.id} option`).toBe(false);
    }
  });

  it('segmented controls hold 2–4 choices; option values are unique', () => {
    for (const d of SETTINGS.filter((x) => x.control.kind === 'segmented')) {
      const opts = d.control.options ?? [];
      expect(opts.length, d.id).toBeGreaterThanOrEqual(2);
      expect(opts.length, d.id).toBeLessThanOrEqual(4);
      expect(new Set(opts.map((o) => String(o.value))).size, d.id).toBe(opts.length);
    }
  });

  it('tools: 2–6 word labels, a route and a known group', () => {
    for (const t of SETTINGS_TOOLS) {
      expect(words(t.label), t.label).toBeGreaterThanOrEqual(2);
      expect(words(t.label), t.label).toBeLessThanOrEqual(6);
      expect(t.href.startsWith('/'), t.id).toBe(true);
      expect(groupIds.has(t.group), t.id).toBe(true);
    }
  });

  it('owner decisions: no short-sample-code row; the sticker code is per branch', () => {
    expect(SETTINGS.some((d) => /number width|sample code/i.test(d.label) || d.key === 'sampleNumberWidth')).toBe(false);
    expect(SETTINGS.find((d) => d.id === 'col.labelCode')!.scope).toBe('branch');
    expect(/organi[sz]ation/i.test(SETTINGS.find((d) => d.id === 'col.labelCode')!.help ?? '')).toBe(false);
  });

  it('rows keep the permission of the page they came from', () => {
    const perm = (id: string) => SETTINGS.find((d) => d.id === id)!.permission;
    expect(perm('col.scanMode')).toEqual(['manage_lab_settings']);
    expect(perm('fd.payGate')).toEqual(['manage_lab_settings']);
    expect(perm('setup.labName')).toEqual(['manage_tenant']);
    expect(perm('setup.slug')).toEqual(['manage_tenant']);
    expect(perm('setup.brandingMode')).toEqual(['manage_tests', 'manage_users', 'manage_workflows']);
  });

  it('rowsOfGroup keeps registry order', () => {
    const lab = rowsOfGroup('lab').map((d) => d.id);
    expect(lab.indexOf('lab.queueFocus')).toBeLessThan(lab.indexOf('lab.requireValidation'));
  });
});

describe('Settings search', () => {
  const ids = (q: string) => searchRows(SETTINGS, q).map((d) => d.id);

  it('"barcode" and "QR" find "How staff find a sample"', () => {
    expect(ids('barcode')).toContain('col.scanMode');
    expect(ids('QR')).toContain('col.scanMode');
    expect(ids('bar code')).toContain('col.scanMode');
    expect(ids('qr code')).toContain('col.scanMode');
  });

  it('label hits rank first', () => {
    expect(ids('sticker')[0]).toBe('col.labelCode');
  });

  it('everyday words: "label" finds the sticker code, "login" the sign-in name', () => {
    expect(ids('label')).toContain('col.labelCode');
    expect(ids('login')).toContain('setup.slug');
  });

  it('every word must match; nonsense finds nothing', () => {
    expect(ids('zzqx')).toEqual([]);
    expect(ids('scan supervisor')).toEqual(['col.noScan']);
  });

  it('an empty query returns everything; tools are searchable too', () => {
    expect(ids('').length).toBe(SETTINGS.length);
    expect(queryWords('  Bar  Code ')).toEqual(['barcode']);
    expect(SETTINGS_TOOLS.filter((t) => matchTool(t, 'audit')).map((t) => t.id)).toEqual(['tool.audit']);
  });
});

describe('Settings access', () => {
  it('Settings opens for any manage_* permission', () => {
    expect(hasAnyManage(['manage_lab_settings'])).toBe(true);
    expect(hasAnyManage(['manage_home_collection'])).toBe(true);
    expect(hasAnyManage(['*'])).toBe(true);
    expect(hasAnyManage(['create_order', 'collect_sample'])).toBe(false);
    expect(hasAnyManage([])).toBe(false);
  });

  it('rows are gated by their own permission and module', () => {
    const scan = SETTINGS.find((d) => d.id === 'col.scanMode')!;
    const stock = SETTINGS.find((d) => d.id === 'col.trackStock')!;
    const on = { perms: ['manage_lab_settings'], moduleOn: () => true };
    expect(canSee(scan, on)).toBe(true);
    expect(canSee(scan, { perms: ['manage_tenant'], moduleOn: () => true })).toBe(false);
    expect(canSee(stock, on)).toBe(true);
    expect(canSee(stock, { ...on, moduleOn: (k) => k !== 'inventory' })).toBe(false);
  });
});
