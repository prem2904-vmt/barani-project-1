import { readFileSync } from 'node:fs';

/**
 * OWNER DECISION (2026-09-30): with OPD visible, the cart stays LAB always —
 * the new-order "choose" dialog is gone — and a SEPARATE stethoscope icon
 * (never a fork inside the cart) opens the OPD consult builder. Both the
 * new-design band-inline group and the classic toolbar carry it, gated on
 * OpdGateService.visible() so it renders nothing in production while OPD is
 * dark. Source-text pinning (no TestBed): matches the existing
 * frontdesk-landing-header.spec.ts style for this file.
 */
const DIR = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(`${DIR}/frontdesk-landing.component.html`, 'utf8');
const ts = readFileSync(`${DIR}/frontdesk-landing.component.ts`, 'utf8');

describe('Frontdesk landing — OPD consult icon (dark, additive)', () => {
  it('new-design band-inline: cart, then consult, then scan, in that order', () => {
    const start = html.indexOf('<ng-container band-inline>');
    const end = html.indexOf('</ng-container>', start);
    expect(start).toBeGreaterThan(-1);
    const block = html.slice(start, end);
    const cartIdx = block.indexOf('aria-label="Create order"');
    const consultIdx = block.indexOf('aria-label="New consultation"');
    const scanIdx = block.indexOf('aria-label="Scan QR code"');
    expect(cartIdx).toBeGreaterThan(-1);
    expect(consultIdx).toBeGreaterThan(cartIdx);
    expect(scanIdx).toBeGreaterThan(consultIdx);
  });

  it('the band-inline consult button is gated on opdGate.visible() and shares the cart tool class', () => {
    const idx = html.indexOf('class="pf-hb-tool press" (click)="newConsult()"');
    expect(idx).toBeGreaterThan(-1);
    const before = html.slice(Math.max(0, idx - 400), idx);
    expect(before).toMatch(/showOrder\(\) && opdGate\.visible\(\)/);
    const btnStart = html.lastIndexOf('<button', idx);
    const btnTag = html.slice(btnStart, html.indexOf('>', idx) + 1);
    expect(btnTag).toContain('aria-label="New consultation"');
    expect(btnTag).not.toMatch(/emoji|🩺/);
  });

  it('the classic toolbar also gates its consult icon on opdGate.visible()', () => {
    const idx = html.indexOf('class="pf-mbar__btn press" aria-label="New consultation"');
    expect(idx).toBeGreaterThan(-1);
    const before = html.slice(Math.max(0, idx - 300), idx);
    expect(before).toMatch(/showOrder\(\) && opdGate\.visible\(\)/);
  });

  it('newOrder() and newConsult() route through OrderEntryService with the right verbs', () => {
    expect(ts).toMatch(/newOrder\(\)\s*\{\s*void this\.orderEntry\.startNewOrder\(\);\s*\}/);
    expect(ts).toMatch(/newConsult\(\)\s*\{\s*void this\.orderEntry\.startConsult\(\);\s*\}/);
    expect(ts).toMatch(/newConsultFor\(p: Patient\)\s*\{\s*void this\.orderEntry\.startConsult\(p\.id\);\s*\}/);
  });

  it('the advanced-search modal gets showConsult + a consult handler, never a dialog choice', () => {
    expect(html).toMatch(/\[showConsult\]="opdGate\.visible\(\)"/);
    expect(html).toMatch(/\(consult\)="newConsultFor\(\$event\)"/);
  });
});
