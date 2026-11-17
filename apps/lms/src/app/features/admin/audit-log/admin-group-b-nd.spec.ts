import { renderBandPage } from '../admin-band.spec-helpers';
import { AuditLogComponent } from './audit-log.component';
import { NotificationsConfigComponent } from '../notifications-config/notifications-config.component';
import { KpiConfigComponent } from '../kpis/kpi-config.component';

/**
 * Current ND rules on Audit / Notifications / KPIs: ≤ ONE primary in the
 * band, palette only (no green / amber / orange marks), no monospace class,
 * slate role=switch toggles, SVG icons instead of glyphs.
 */
const noLoudColours = (el: HTMLElement) =>
  expect(el.querySelector('.pf-band-body')!.innerHTML).not.toMatch(/#10b981|#34d399|#f59e0b|#f0a35e|rgba\(16,\s?185|rgba\(245,\s?158|rgba\(232,\s?119/i);
const noMono = (el: HTMLElement) => expect(el.querySelector('.pf-band-body .font-mono, .pf-band-body code')).toBeNull();

describe('Audit trail — ND audit', () => {
  const page = { items: [
    { id: 'l1', entityType: 'OrderEntity', entityId: '5f1c2a9e-0000-4444-8888-123456789abc', action: 'create', userName: 'Asha', at: '2026-09-20T10:00:00Z', changes: null },
    { id: 'l2', entityType: 'OrderEntity', entityId: 'ord-2', action: 'delete', userName: 'Ravi', at: '2026-09-20T11:00:00Z', changes: null },
  ], total: 2 };
  const make = () => renderBandPage(AuditLogComponent, { getFor: (u) => (u.startsWith('/api/audit/logs') ? page : []) });

  it('neutral action chips (violet dot = create, red text = delete); full record id in tabular Noto', () => {
    const p = make();
    const chips = p.el.querySelectorAll('.audit-badge.pf-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].getAttribute('data-tone')).toBe('add');
    expect(chips[0].querySelector('.audit-badge__dot')).not.toBeNull();
    expect(chips[1].getAttribute('data-tone')).toBe('warn');
    expect(chips[0].getAttribute('style')).toBeNull();
    expect(p.el.querySelector('.audit-id.pf-num')!.textContent).toContain('5f1c2a9e-0000-4444-8888-123456789abc');
    noMono(p.el);
    noLoudColours(p.el);
    expect(p.el.querySelectorAll('pf-hero-band .pf-hb-btn--primary').length).toBe(0);
  });
});

describe('Notifications — ND audit', () => {
  const rows = [
    { key: 'a', module: 'lab', label: 'Sample rejected', firesWhen: 'x', recipients: 'Front desk', kind: 'instant', enabled: true, thresholdMinutes: null, thresholdConfigurable: false },
    { key: 'b', module: 'lab', label: 'Result overdue', firesWhen: 'y', recipients: 'Lab head', kind: 'overdue', enabled: false, thresholdMinutes: 30, thresholdConfigurable: true },
  ];
  const make = () => renderBandPage(NotificationsConfigComponent, { getFor: (u) => (u.includes('/notifications/catalog') ? rows : []) });

  it('slate role=switch per alert; overdue = neutral chip; no orange', () => {
    const p = make();
    const sw = p.el.querySelectorAll('.pf-nc-card .pf-toggle[role="switch"]');
    expect(sw.length).toBe(2);
    expect(sw[0].getAttribute('aria-checked')).toBe('true');
    expect(p.el.querySelector('pf-toggle')).toBeNull();
    expect(p.el.querySelector('.pf-nc-badge')!.classList.contains('pf-chip')).toBe(true);
    (sw[1] as HTMLButtonElement).click();
    p.f.detectChanges();
    expect(p.api.put.mock.calls.length + p.api.post.mock.calls.length + p.api.patch.mock.calls.length).toBeGreaterThan(0);
    noLoudColours(p.el);
    noMono(p.el);
  });
});

describe('KPIs — ND audit', () => {
  const catalog = [{ id: 'k1', code: 'CASH_IN', name: 'Cash in', category: 'financial', valueType: 'money', defaultLabel: 'Cash in' }];
  const make = () => renderBandPage(KpiConfigComponent, {
    getFor: (u) => (u === '/api/kpis' ? catalog : u.startsWith('/api/kpis/assignments') ? [] : []),
  });

  it('no band primary — Save lives in the card\'s Save bar; the grid\'s Shown cell is the kit switch, moves are SVG icon actions', () => {
    const p = make();
    expect(p.el.querySelectorAll('pf-hero-band .pf-hb-btn--primary').length).toBe(0);
    p.cmp.addToScreen(catalog[0]);
    p.f.detectChanges();
    expect(p.el.querySelector('pf-settings-savebar .pf-btn--secondary')!.textContent).toContain('Save');
    const row = p.cmp.gridRows()[0];
    const cols = p.cmp.colDefs();
    const shown = cols.find((c: any) => c.colId === 'status').cellRenderer({ data: row }) as HTMLElement;
    expect(shown.querySelector('.pf-toggle[role="switch"]')).not.toBeNull();
    expect(shown.querySelector('input[type=checkbox]')).toBeNull();
    const acts = cols.find((c: any) => c.colId === 'actions').cellRenderer({ data: row }) as HTMLElement;
    expect(acts.querySelectorAll('button svg').length).toBe(3);
    expect(/[▲▼⋮＋]/.test(p.el.querySelector('.pf-band-body')!.textContent ?? '')).toBe(false);
    noMono(p.el);
  });
});
