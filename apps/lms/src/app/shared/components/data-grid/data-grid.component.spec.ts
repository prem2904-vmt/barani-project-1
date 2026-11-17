import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataGridComponent } from './data-grid.component';
import { ThemeService } from '../../../core/services/theme.service';

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
