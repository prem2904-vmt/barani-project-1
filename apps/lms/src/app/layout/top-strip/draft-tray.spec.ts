import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DraftChip } from '../../core/services/draft-shelf.service';
import { draftAgo, draftCap, draftDetail, draftMenuActions, draftSplit, draftTitle } from './draft-tray';

/**
 * Draft tray (owner 2026-10-02: "as a pill it is not nice — the sample
 * number is enough"). Chips show ONLY the sample number; the patient name
 * rides the tooltip / accessible name / overflow menu.
 */
const LAB = (n: number): DraftChip => ({
  id: 'lab:s' + n, label: String(26120 + n), sub: 'Patient ' + n, verb: 'Resume result for', link: ['/lab/sample', 's' + n],
});
const NOW = Date.parse('2026-10-02T10:00:00Z');
const read = (p: string) => readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip', p), 'utf8');

describe('draft tray — how many chips sit inline', () => {
  it('grows with the bar: 3 on tablets, up to 6 on wide desktops', () => {
    expect(draftCap(800)).toBe(3);
    expect(draftCap(1024)).toBe(4);
    expect(draftCap(1280)).toBe(5);
    expect(draftCap(1440)).toBe(5);
    expect(draftCap(1536)).toBe(6);
    expect(draftCap(2560)).toBe(6);
  });

  it('splits into inline chips + a "+N" count, never a "+1" that hides a single draft', () => {
    const six = [1, 2, 3, 4, 5, 6].map(LAB);
    expect(draftSplit(six.slice(0, 4), 3)).toEqual({ shown: six.slice(0, 4), more: 0 });
    expect(draftSplit(six, 3)).toEqual({ shown: six.slice(0, 3), more: 3 });
    expect(draftSplit(six, 6).more).toBe(0);
    expect(draftSplit([], 4)).toEqual({ shown: [], more: 0 });
    // A measured fit is exact: 4 drafts in room for 3 → 3 + "+1".
    expect(draftSplit(six.slice(0, 4), 3, true)).toEqual({ shown: six.slice(0, 3), more: 1 });
    expect(draftSplit(six.slice(0, 3), 3, true).more).toBe(0);
    // No room for even one chip: collapse to the count (all in the menu).
    expect(draftSplit(six, 0, true)).toEqual({ shown: [], more: 6 });
    expect(draftSplit(six, 0).shown.length).toBe(1);
  });
});

describe('draft tray — words', () => {
  it('tooltip / aria name carries the patient the chip no longer prints', () => {
    const d = { ...LAB(3), label: '26123', sub: 'Mr. Sathish Kumar' };
    expect(draftTitle(d, false, NOW)).toBe('Resume result for 26123 · Mr. Sathish Kumar');
    expect(draftTitle(d, true, NOW)).toBe('Open now — 26123 · Mr. Sathish Kumar');
    expect(draftTitle({ id: 'x', label: 'A', link: '/x' }, false, NOW)).toBe('Resume draft A');
  });

  it('relative time only when the publisher knows it', () => {
    expect(draftAgo(undefined, NOW)).toBe('');
    expect(draftAgo('garbage', NOW)).toBe('');
    expect(draftAgo(NOW - 20_000, NOW)).toBe('just now');
    expect(draftAgo(NOW - 4 * 60_000, NOW)).toBe('4 min ago');
    expect(draftAgo(new Date(NOW - 2 * 3600_000).toISOString(), NOW)).toBe('2 h ago');
    expect(draftAgo(NOW - 26 * 3600_000, NOW)).toBe('yesterday');
    expect(draftAgo(NOW - 3 * 86400_000, NOW)).toBe('3 d ago');
    expect(draftDetail({ ...LAB(1), at: NOW - 5 * 60_000 }, NOW)).toBe('Patient 1 · 5 min ago');
  });

  it('the "+N" menu lists EVERY draft: number, patient · time as the hint, the on-stage one current', () => {
    const items = [LAB(1), LAB(2), { ...LAB(3), at: NOW - 60_000 }];
    const rows = draftMenuActions(items, 'lab:s2', NOW);
    expect(rows.map(r => r.label)).toEqual(['26121', '26122', '26123']);
    expect(rows.map(r => r.hint)).toEqual(['Patient 1', 'Open now · Patient 2', 'Patient 3 · 1 min ago']);
    expect(rows.map(r => !!r.current)).toEqual([false, true, false]);
    expect(rows.every(r => r.icon === 'edit')).toBe(true);
  });
});

describe('draft tray — measured fit', () => {
  it('drops a chip at a time while the inline chips overflow the bar', () => {
    const ts = read('top-strip.component.ts');
    expect(ts).toMatch(/box\.scrollWidth > box\.clientWidth \+ 1 && cap > 0[\s\S]*this\.draftFit\.set\(cap - 1\)/);
    // Re-measured from the width ceiling whenever the drafts or the viewport change.
    expect(ts).toMatch(/this\.draftShelf\.items\(\);\s*this\.viewportW\(\);[\s\S]*this\.draftFit\.set\(null\)/);
  });
});

describe('draft tray — template + styles', () => {
  const html = read('top-strip.component.html');
  const tray = html.slice(html.indexOf('Draft tray (owner)'), html.indexOf('Spacer pushes'));
  const scss = read('top-strip.component.scss');
  const css = scss.slice(scss.indexOf('Draft tray (bottom bar)'), scss.indexOf('Chat entry (new design)'));

  it('a chip renders ONLY its label (no patient sub-line); the name is in title + aria-label', () => {
    expect(tray).not.toMatch(/\{\{\s*d\.sub\s*\}\}/);
    expect(tray).toMatch(/\[title\]="draftTitle\(d, on\)" \[attr\.aria-label\]="draftTitle\(d, on\)"/);
    expect(tray).toContain('<span class="pf-draftshelf__lbl">{{ d.label }}</span>');
  });

  it('overflow uses the app\'s ONE menu (pf-actions-menu), not a hand-rolled popover', () => {
    expect(tray).toMatch(/<pf-actions-menu[^>]*\[actions\]="draftMenu\(\)"[^>]*\(action\)="resumeDraft\(\$event\)"/);
    expect(tray).toMatch(/<button pfActionsTrigger type="button" class="pf-draftshelf__chip pf-draftshelf__more/);
    expect(tray).not.toContain('pf-draftshelf__pop');
    expect(tray).not.toMatch(/<select|datalist|[\u{1F300}-\u{1FAFF}✎]/u);
  });

  it('selection is driven by ARIA, not a "--on" class (the global violet rule stays out of it)', () => {
    expect(tray).not.toMatch(/--on/);
    expect(tray).toMatch(/\[attr\.aria-current\]="on \? 'page' : null"/);
    expect(css).toMatch(/\.pf-draftshelf__chip\[aria-current\]/);
  });

  it('solid chips: no dashed borders, no pill radius, tabular figures, kit tokens, light + dark', () => {
    expect(css).not.toMatch(/dashed/);
    expect(css).not.toMatch(/9999px/);
    expect(css).toMatch(/\.pf-draftshelf__chip \{[^}]*border-radius:\s*var\(--nd-radius-chip/);
    expect(css).toMatch(/\.pf-draftshelf__chip \{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/:host-context\(\.dark\) \.pf-draftshelf__chip \{/);
    expect(css).toContain('prefers-reduced-motion');
    // 44px touch hit box without growing the bar.
    expect(css).toMatch(/pointer: coarse[\s\S]*height: 44px/);
  });
});
