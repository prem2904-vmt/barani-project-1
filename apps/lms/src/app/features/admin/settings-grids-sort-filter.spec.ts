import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { sortsAndFilters } from '../../shared/utils/work-grid';
import { HomeCollectionAgentsComponent } from './home-collection/home-collection-agents.component';
import { KpiConfigComponent } from './kpis/kpi-config.component';
import { ReferralLabsComponent } from './referral-labs/referral-labs.component';
import { VendorsComponent } from './vendors/vendors.component';
import { InventoryComponent } from './inventory/inventory.component';

/**
 * Owner 2026-11-21: "wherever a grid is used, filter and sort must be there." Every data column of these Settings
 * grids is built by a work-grid helper (sorts + filters on its real value); only icon / action columns are exempt.
 */
function check(cols: any[], ids: string[]) {
  const data = cols.filter((c) => c.colId !== 'actions');
  expect(data.map((c) => c.colId)).toEqual(ids);
  for (const c of data) expect(sortsAndFilters(c), c.colId).toBe(true);
  const act = cols.find((c) => c.colId === 'actions');
  if (act) { expect(act.sortable).toBe(false); expect(act.filter).toBe(false); }
}

describe('Settings grids — sort + filter on every data column', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Home collection agents', () => {
    const p = renderBandPage(HomeCollectionAgentsComponent, { getFor: () => [] });
    // "status" is only listed when an agent is inactive.
    const ids = (p.cmp.colDefs() as any[]).map((c) => c.colId).filter((i) => i !== 'actions');
    check(p.cmp.colDefs(), ids);
    expect(ids).toEqual(expect.arrayContaining(['agent', 'coverage', 'weight']));
  });

  it('KPI configuration', () => {
    const p = renderBandPage(KpiConfigComponent, { getFor: () => [] });
    check(p.cmp.colDefs(), ['order', 'kpi', 'kind', 'status']);
  });

  it('Referral labs', () => {
    const p = renderBandPage(ReferralLabsComponent, { getFor: () => [] });
    check(p.cmp.colDefs(), ['name', 'code', 'contact', 'departments', 'status']);
  });

  it('Vendors', () => {
    const p = renderBandPage(VendorsComponent, { getFor: () => [] });
    check(p.cmp.colDefs(), ['name', 'code', 'status', 'charged', 'settled', 'outstanding']);
  });

  it('Inventory items', () => {
    const p = renderBandPage(InventoryComponent, { getFor: () => [] });
    const cols = p.cmp.itemCols() as any[];
    check(cols, ['item', 'category', 'onHand', 'reorder', 'status']);
    // Money / counts sort on the number, not the formatted text.
    expect(cols.find((c) => c.colId === 'onHand').valueGetter({ data: { onHand: 7 } })).toBe(7);
  });
});
