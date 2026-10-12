import { AuditLogComponent } from './audit-log.component';
import { renderBandPage } from '../admin-band.spec-helpers';

/**
 * The CLASSIC filter card (kept in the DOM behind `pf-classic-only`, see
 * PF-PATTERN) used native `<select>` + `<input type="date">` for Record
 * type / Action / From / To — now pf-select + pf-date, same as the band
 * pill's already-converted controls.
 */
describe('Audit log — classic filter card (no native controls)', () => {
  const page = { items: [], total: 0 };
  const make = () => renderBandPage(AuditLogComponent, { getFor: (u) => (u.startsWith('/api/audit/logs') ? page : []) });

  it('Record type / Action are pf-select; From / To are pf-date', () => {
    const p = make();
    const card = p.el.querySelector('.pf-band-body > pf-tile')!;
    expect(card.querySelectorAll('pf-select').length).toBe(2);
    expect(card.querySelectorAll('pf-date').length).toBe(2);
    expect(card.querySelector('select')).toBeNull();
    expect(card.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('picking a From date in the classic card calls patch({ from })', () => {
    const p = make();
    const card = p.el.querySelector('.pf-band-body > pf-tile')!;
    const dateInputs = card.querySelectorAll<HTMLInputElement>('pf-date input[type="text"]');
    dateInputs[0].value = '01092026';
    dateInputs[0].dispatchEvent(new Event('input'));
    p.f.detectChanges();
    expect(p.cmp.filters().from).toBe('2026-09-01');
  });
});
