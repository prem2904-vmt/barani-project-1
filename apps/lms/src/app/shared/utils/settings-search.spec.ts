import { normSettingsText, searchSettings, settingsRank } from './settings-search';
import { SETTINGS_CATALOG, SETTINGS_PARENT, SettingsEntry, settingsKeywordsFor } from './settings-catalog';

/**
 * Settings search is PRECISE (owner 2026-11-01: "the search in settings have
 * to be precise"): titles + keywords only, whole words / word prefixes only,
 * ranked exact title → title prefix → title words → keyword. Real examples
 * run against the real catalog.
 */
const run = (q: string) =>
  searchSettings(SETTINGS_CATALOG, q, (e) => e.title, (e) => e.keywords ?? []);
const titles = (q: string) => run(q).map((e) => e.title);

describe('settings search — ranking tiers', () => {
  it('exact title, then title prefix at a word, then title prefix, then whole words, then word prefixes', () => {
    expect(settingsRank('lab settings', 'Lab settings')).toBe(0);
    expect(settingsRank('sample id', 'Sample ID format')).toBe(1);
    expect(settingsRank('sample id', 'Sample identification')).toBe(2);
    expect(settingsRank('label code', 'Specimen label code')).toBe(3);
    expect(settingsRank('spec code', 'Specimen label code')).toBe(4);
    expect(settingsRank('barcode', 'Specimen label code', ['barcode'])).toBe(5);
    expect(settingsRank('invoice num', 'Billing Config', ['invoice number'])).toBe(6);
    expect(settingsRank('gst tax', 'Billing Config', ['gst', 'tax'])).toBe(7);
  });

  it('never matches inside a word or in a description', () => {
    expect(settingsRank('ample', 'Sample identification')).toBeNull();
    expect(settingsRank('dentification', 'Sample identification')).toBeNull();
    // A word that only appears in a page's description / subtitle is not searched.
    expect(titles('arrange')).toEqual([]);
    expect(titles('smudged')).toEqual([]);
  });

  it('case, "&" and punctuation do not matter', () => {
    expect(normSettingsText('Counters &amp; collection')).toBe('counters and collection');
    expect(settingsRank('COUNTERS & COLLECTION', 'Counters & collection')).toBe(0);
    expect(settingsRank('payments due', 'Show "Payments due" tab')).toBe(3);
  });

  it('an empty query finds nothing; an unknown word finds nothing', () => {
    expect(run('')).toEqual([]);
    expect(run('   ')).toEqual([]);
    expect(run('zzqx')).toEqual([]);
  });
});

describe('settings search — real examples', () => {
  it('"sample id" → the Sample ID format first, then Sample identification, then the prefix homes', () => {
    const t = titles('sample id');
    expect(t[0]).toBe('Sample ID format');
    expect(t[1]).toBe('Sample identification');
    expect(t).toContain('Default Lab code');
    // the removed Lab settings "number width" card is gone from the index
    expect(t).not.toContain('Sample ID');
    expect(run('sample id')[0].href).toBe('/admin/lab/sample-numbers');
    expect(run('sample id')[0].queryParams).toEqual({ tab: 'format' });
  });

  it('"barcode" → Specimen label code first (exact keyword)', () => {
    expect(titles('barcode')[0]).toBe('Specimen label code');
  });

  it('"logo" → Logo and top bar first, then Report design', () => {
    const t = titles('logo');
    expect(t[0]).toBe('Logo and top bar');
    expect(t).toContain('Report design');
    expect(t.indexOf('Logo and top bar')).toBeLessThan(t.indexOf('Report design'));
  });

  it('"printer" → only printing settings, the printer cards before the page', () => {
    const hits = run('printer');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.href === '/printing')).toBe(true);
    expect(hits.map((h) => h.title)).toEqual(expect.arrayContaining(['Label printer', 'Invoice / document printer', 'Printing']));
  });

  it('"branch" → Branches first', () => {
    expect(titles('branch')[0]).toBe('Branches');
  });

  it('"lab settings" → Collection and queues (the old Lab settings page) first; "lab" → a Lab-titled setting first', () => {
    expect(run('lab settings')[0].href).toBe('/admin/lab/collection');
    expect(run('lab')[0].title.toLowerCase()).toContain('lab');
  });

  it('"abnormal" → the ONE abnormal-results switch, in Report Template', () => {
    const hits = run('abnormal');
    expect(hits.map((h) => h.title)).toEqual(['Consolidated abnormal results sheet']);
    expect(hits[0].href).toBe('/admin/reports');
    expect(hits[0].section).toContain('Report design');
  });

  it('every hit says where it lives', () => {
    for (const h of run('a')) expect(h.section.length).toBeGreaterThan(0);
  });
});

describe('settings catalog — one home per setting', () => {
  it('every title is unique, so each setting has ONE home', () => {
    const seen = new Map<string, SettingsEntry>();
    for (const e of SETTINGS_CATALOG) {
      const k = normSettingsText(e.title);
      expect(seen.has(k), `"${e.title}" is listed twice`).toBe(false);
      seen.set(k, e);
    }
  });

  it('every setting is findable by its visible title — and comes out on top', () => {
    for (const e of SETTINGS_CATALOG) {
      expect(run(e.title)[0], e.title).toBe(e);
    }
  });

  it('every settings page has a parent hub for its back chevron (personal pages and nav roots aside)', () => {
    const pages = SETTINGS_CATALOG.filter((e) => e.kind === 'page').map((e) => e.href);
    for (const href of pages) {
      if (['/printing'].includes(href)) continue; // personal page
      expect(SETTINGS_PARENT[href], href).toBeTruthy();
    }
  });

  it('tile keywords include the settings on that page', () => {
    expect(settingsKeywordsFor('/admin/lab/collection')).toContain('Queue focus');
    expect(settingsKeywordsFor('/admin/lab/outsourcing')).toEqual(expect.arrayContaining(['outsource', 'external lab']));
  });
});
