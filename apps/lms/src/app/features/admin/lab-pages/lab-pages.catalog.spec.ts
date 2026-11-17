import { ROUTE_ACCESS } from '../../../core/auth/route-access';
import { LAB_PAGES, LEGACY_LAB_SETTINGS_CARD_TARGET, LEGACY_LAB_SETTINGS_TARGET, resolveLabTab } from '../../../shared/utils/lab-settings-pages';
import { readFileSync } from 'node:fs';

/**
 * The Lab pages' catalog is what the Settings shell's left panel reads: every
 * page is routed + guarded, every legacy card has a target that exists.
 */
describe('Lab settings pages — catalog', () => {
  const pages = Object.values(LAB_PAGES);
  // Every Lab page is hosted by the Settings shell: one row in the ONE route table.
  const routes = readFileSync('apps/lms/src/app/features/admin/settings/settings.routes.ts', 'utf8');
  const map = readFileSync('apps/lms/src/app/features/admin/settings/settings-map.ts', 'utf8');

  it('has the eight pages of the re-home, each under /admin/lab/', () => {
    expect(pages.map(p => p.path)).toEqual([
      '/admin/lab/sample-numbers', '/admin/lab/collection', '/admin/lab/results', '/admin/lab/home-collection',
      '/admin/lab/front-desk', '/admin/lab/alerts', '/admin/lab/numbers', '/admin/lab/report-options',
    ]);
  });

  it('every page is guarded (route access) and routed, and category ids are unique', () => {
    for (const p of pages) {
      expect(ROUTE_ACCESS[p.path], p.path).toBeDefined();
      expect(map, p.path).toContain(`'${p.path}'`);
      const key = /(\w+): '([^']+)'/g; let k: string | null = null;
      for (let m = key.exec(map); m; m = key.exec(map)) if (m[2] === p.path) { k = m[1]; break; }
      expect(routes, p.path).toContain(`page(P.${k},`);
      const ids = p.categories.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(p.categories.every(c => c.label.length > 0)).toBe(true);
    }
  });

  it('resolveLabTab keeps a valid ?tab= and falls back to the first category', () => {
    expect(resolveLabTab(LAB_PAGES.sampleNumbers, 'barcode')).toBe('barcode');
    expect(resolveLabTab(LAB_PAGES.sampleNumbers, 'nope')).toBe('format');
    expect(resolveLabTab(LAB_PAGES.sampleNumbers, null)).toBe('format');
  });

  it('every legacy Lab-settings tab / card maps to a real page + category', () => {
    for (const t of [...Object.values(LEGACY_LAB_SETTINGS_TARGET), ...Object.values(LEGACY_LAB_SETTINGS_CARD_TARGET)]) {
      const page = pages.find(p => p.path === t.path);
      expect(page, t.path).toBeDefined();
      expect(page!.categories.map(c => c.id), `${t.path} ${t.tab}`).toContain(t.tab);
    }
  });

  it('the copy has no emoji and no "AI"', () => {
    const copy = pages.flatMap(p => [p.title, ...p.categories.map(c => c.label)]).join(' ');
    expect(copy).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(copy).not.toMatch(/\bAI\b/);
  });
});
