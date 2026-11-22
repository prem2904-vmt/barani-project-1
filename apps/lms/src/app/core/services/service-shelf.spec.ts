import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ModuleId } from '../modules/module-catalog';
import {
  availableServices, effectiveService, inService, serviceChips, serviceOfModule, showServiceShelf, tallyServices,
} from './service-shelf';
import { ServiceShelfService } from './service-shelf.service';

/** Frontdesk Services shelf (owner 2026-11-19): derived ONLY from the existing gates; 2+ services or nothing. */
const on = (...ids: ModuleId[]) => (id: ModuleId) => ids.includes(id);
const live = () => 'live' as const;

describe('services — derived from entitlements + permissions + beta gates', () => {
  it('a lab-only tenant has ONE service → no shelf (exactly today\'s bar)', () => {
    const s = availableServices({ moduleOn: on('lab', 'inventory'), opdVisible: false, opdDesk: true });
    expect(s.map(x => x.id)).toEqual(['lab']);
    expect(showServiceShelf(s)).toBe(false);
  });

  it('OPD needs BOTH the OPD gate (pf.opd() / entitlement) and desk permission', () => {
    expect(availableServices({ moduleOn: on('lab'), opdVisible: true, opdDesk: true }).map(x => x.id)).toEqual(['lab', 'opd']);
    expect(availableServices({ moduleOn: on('lab'), opdVisible: true, opdDesk: false }).map(x => x.id)).toEqual(['lab']);
    // The stored module map can never open OPD on its own — only the gate does.
    expect(availableServices({ moduleOn: on('lab', 'opd'), opdVisible: false, opdDesk: true }).map(x => x.id)).toEqual(['lab']);
    expect(showServiceShelf(availableServices({ moduleOn: on('lab'), opdVisible: true, opdDesk: true }))).toBe(true);
  });

  it('IPD / Scan / ER need their module ON and built (a "coming soon" module has no front-desk work)', () => {
    const soon = availableServices({ moduleOn: on('lab', 'ipd', 'radiology', 'emergency'), opdVisible: false, opdDesk: true });
    expect(soon.map(x => x.id)).toEqual(['lab']);
    const built = availableServices({ moduleOn: on('lab', 'ipd', 'radiology', 'emergency'), opdVisible: true, opdDesk: true, statusOf: live });
    expect(built.map(x => x.id)).toEqual(['lab', 'opd', 'ipd', 'scan', 'er']);
    expect(built.map(x => x.label)).toEqual(['Lab', 'OPD', 'IPD', 'Scan', 'ER']);
    // Lab switched off for the tenant: never offered.
    expect(availableServices({ moduleOn: on('ipd'), opdVisible: false, opdDesk: false, statusOf: live }).map(x => x.id)).toEqual(['ipd']);
  });

  it('a remembered pick that is no longer granted falls back to All', () => {
    const s = availableServices({ moduleOn: on('lab'), opdVisible: true, opdDesk: true });
    expect(effectiveService('opd', s)).toBe('opd');
    expect(effectiveService('ipd', s)).toBe('all');
    expect(effectiveService('nonsense', s)).toBe('all');
    expect(effectiveService(null, s)).toBe('all');
    expect(effectiveService('all', s)).toBe('all');
  });

  it('an order belongs to its owning module (lab when unset)', () => {
    expect(serviceOfModule(undefined)).toBe('lab');
    expect(serviceOfModule('LAB')).toBe('lab');
    expect(serviceOfModule('opd')).toBe('opd');
    expect(serviceOfModule('radiology')).toBe('scan');
    expect(serviceOfModule('emergency')).toBe('er');
    expect(inService('all', 'opd')).toBe(true);
    expect(inService('lab', 'opd')).toBe(false);
    expect(inService('opd', 'opd')).toBe(true);
  });

  it('chips: All first with the total, then each service with its count and a late flag', () => {
    const s = availableServices({ moduleOn: on('lab'), opdVisible: true, opdDesk: true });
    const t = tallyServices([{ s: 'lab', l: false }, { s: 'lab', l: false }, { s: 'opd', l: true }] as const, x => x.s, x => x.l);
    const chips = serviceChips(s, t, 'opd');
    expect(chips.map(c => [c.label, c.n, c.late, c.selected])).toEqual([
      ['All', 3, true, false], ['Lab', 2, false, false], ['OPD', 1, true, true],
    ]);
  });
});

describe('services shelf — area ownership', () => {
  it('only the Frontdesk area', () => {
    expect(ServiceShelfService.isFrontdesk('/frontdesk')).toBe(true);
    expect(ServiceShelfService.isFrontdesk('/frontdesk/order?patientId=1')).toBe(true);
    expect(ServiceShelfService.isFrontdesk('/frontdesk?x=1')).toBe(true);
    expect(ServiceShelfService.isFrontdesk('/frontdesk-old')).toBe(false);
    expect(ServiceShelfService.isFrontdesk('/lab/my-work')).toBe(false);
  });

  it('the bar renders it only while visible (Frontdesk + 2 services); Lab keeps its Drafts shelf', () => {
    const html = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.html'), 'utf8');
    expect(html).toMatch(/@if \(themeService\.isNewDesign\(\) && themeService\.bottomNav\(\) && serviceShelf\.visible\(\)\) \{\s*(<!--[\s\S]*?-->\s*)?<pf-services-shelf/);
    // Drafts are untouched and still keyed on their own list.
    expect(html).toMatch(/@if \(themeService\.isNewDesign\(\) && themeService\.bottomNav\(\) && draftShelf\.items\(\)\.length\)/);
    // The drafts' measured fit only ever looks at the DRAFT shelf (never the Services chips).
    const ts = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.ts'), 'utf8');
    expect(ts).toContain('.pf-draftshelf:not(.pf-svcshelf) .pf-draftshelf__scroll');
  });

  it('the Services shelf wears EXACTLY the Drafts shelf look (its copy never drifts)', () => {
    const dir = 'apps/lms/src/app/layout/top-strip/';
    const strip = readFileSync(resolve(process.cwd(), dir + 'top-strip.component.scss'), 'utf8');
    const copy = readFileSync(resolve(process.cwd(), dir + '_shelf.scss'), 'utf8');
    const shelf = readFileSync(resolve(process.cwd(), dir + 'services-shelf.component.scss'), 'utf8');
    const block = strip.slice(strip.indexOf('/* ── Draft tray (bottom bar)'), strip.indexOf('/* Chat entry (new design)')).trim();
    expect(block.length).toBeGreaterThan(500);
    expect(copy.slice(copy.indexOf('/* ── Draft tray (bottom bar)')).trim()).toBe(block);
    expect(shelf).toContain("@include meta.load-css('shelf')");
  });
});
