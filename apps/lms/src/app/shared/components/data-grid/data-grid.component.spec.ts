import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataGridComponent } from './data-grid.component';
import { ThemeService } from '../../../core/services/theme.service';
import { GRID_DARK_SURFACE, GRID_SIZE, GRID_TOUCH_CSS } from '../../../features/admin/tests/tests/grid-theme';
import { ND_GRID_PARAMS } from '../../utils/pf-grid-theme';

@Component({
  standalone: true,
  imports: [DataGridComponent],
  template: `<div class="pf-band-body pf-band-body--fill" style="height:600px;display:flex;flex-direction:column">
    <pf-data-grid [rowData]="rows()" [columnDefs]="cols" [loading]="loading()" emptyTitle="Nothing here" [clickable]="true"></pf-data-grid>
  </div>`,
})
class HostCmp {
  rows = signal<{ id: string; name: string }[]>([]);
  loading = signal(false);
  cols = [{ field: 'name' as const, headerName: 'Name' }];
}

describe('pf-data-grid (Test Master grid as a component)', () => {
  beforeEach(() => {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    TestBed.configureTestingModule({ imports: [HostCmp], providers: [{ provide: ThemeService, useValue: { isDark: () => false } }] });
  });

  it('renders AG-Grid with the Test Master theme; skeleton while loading; small empty state with no rows', () => {
    const f = TestBed.createComponent(HostCmp);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const dg = el.querySelector('pf-data-grid')!;
    expect(dg.querySelector('ag-grid-angular.pf-dg__grid')).not.toBeNull();
    expect(dg.classList.contains('pf-dg--clickable')).toBe(true);
    expect(dg.querySelector('[data-testid="dg-empty"]')!.textContent).toContain('Nothing here');
    f.componentInstance.loading.set(true); f.detectChanges();
    expect(dg.querySelector('pf-skeleton-table')).not.toBeNull();
    expect(dg.querySelector('[data-testid="dg-empty"]')).toBeNull();
    f.componentInstance.loading.set(false);
    f.componentInstance.rows.set([{ id: 'a', name: 'A' }]); f.detectChanges();
    expect(dg.querySelector('[data-testid="dg-empty"]')).toBeNull();
  });
});

describe('grid size + dark surface live in the shared theme only (owner 2026-11-19)', () => {
  it('rows / header read the shared variables: 56 / 40 on web, 64 / 48 on touch, 44px hit areas on touch', () => {
    expect(GRID_SIZE).toEqual({ rowHeight: 'var(--pf-grid-row-h, 56px)', headerHeight: 'var(--pf-grid-head-h, 40px)' });
    expect(ND_GRID_PARAMS.rowHeight).toBe(GRID_SIZE.rowHeight);
    const css = GRID_TOUCH_CSS;
    expect(css).toMatch(/& \{ --pf-grid-row-h: 56px; --pf-grid-head-h: 40px; \}/);
    expect(css).toMatch(/@media not \(\(hover: hover\) and \(pointer: fine\)\) \{\s*& \{ --pf-grid-row-h: 64px; --pf-grid-head-h: 48px; \}/);
    expect(css).toMatch(/width: max\(100%, 44px\); height: max\(100%, 44px\)/);
  });

  it('no screen sets its own grid row height', () => {
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync("grep -rlE 'rowHeight: *[0-9]+' apps/lms/src/app --include=*.ts --exclude=*.spec.ts || true", { encoding: 'utf8' }).trim();
    expect(hits).toBe('');
  });

  it('dark surfaces are opaque: rows / pinned / popups = the card, the header = the card + a 4% tint', () => {
    expect(GRID_DARK_SURFACE.backgroundColor).toBe('var(--pf-card-bg)');
    expect(GRID_DARK_SURFACE.pinnedRowBackgroundColor).toBe('var(--pf-card-bg)');
    expect(GRID_DARK_SURFACE.headerBackgroundColor).toBe('color-mix(in srgb, var(--text-primary) 4%, var(--pf-card-bg))');
    expect(Object.values(GRID_DARK_SURFACE).filter(v => String(v).includes('transparent') && !String(v).includes('#a855f7'))).toEqual([]);
  });
});
