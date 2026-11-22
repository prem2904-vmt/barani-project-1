import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { CulturePanelComponent } from './culture-panel.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ThemeService } from '../../../core/services/theme.service';

/** Culture tiles in the new design match the other My Work tiles (owner):
 *  no stripe, sample ID primary, next step as a neutral chip, quiet chevron. */
let fixture: { detectChanges(): void } | null = null;
function render(newDesign: boolean) {
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
  const cases = [{
    orderTestId: 'ot-1', caseState: 'in_progress', createdAt: new Date().toISOString(),
    barcode: 'MICRO26001', patientName: 'Mrs. Shanthi M', testName: 'Bacterial Culture & Sensitivity',
    departmentName: 'Microbiology', stages: [{ key: 'gram', label: 'Gram / Direct smear', state: 'open' }],
  }];
  TestBed.configureTestingModule({
    imports: [CulturePanelComponent],
    providers: [
      { provide: ApiService, useValue: { get: () => of(cases) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me' }), hasPermission: () => true } },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ThemeService, useValue: { isNewDesign: signal(newDesign), isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(CulturePanelComponent);
  f.detectChanges();
  fixture = f;
  return f.nativeElement as HTMLElement;
}

afterEach(() => TestBed.resetTestingModule());

describe('Culture tiles — new design', () => {
  it('the new design draws the culture cases on the work GRID (owner 2026-11-20) — sample ID, full name, test · department, next step, Due, Open', async () => {
    const el = render(true);
    for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 40)); fixture!.detectChanges(); }
    expect(el.querySelector('li.pf-cc')).toBeNull();
    expect(el.querySelector('pf-data-grid[data-testid="cg-grid"]')).not.toBeNull();
    const row = el.querySelector('.ag-row.cg-row')!;
    expect(row.querySelector('.wg-id')?.textContent?.trim()).toBe('MICRO26001');
    expect(row.querySelector('.wg-who__name')?.textContent?.trim()).toBe('Mrs. Shanthi M');
    expect(row.textContent).toContain('Bacterial Culture & Sensitivity · Microbiology');
    expect(row.querySelector('.cg-next .pf-sw__now')?.textContent?.trim()).toBe('Gram / Direct smear');
    expect(row.querySelector('.cg-next .pf-sw__detail')?.textContent?.trim()).toBe('Not started');
    expect(row.querySelector('.wg-pill')).toBeNull();
    expect(row.querySelector('[data-action="bench"]')?.textContent?.trim()).toBe('Open');
    expect(row.querySelector('pf-journey-ring')).toBeNull();   // Due instead of a journey ring (owner 2026-11-21)
    expect(row.querySelector('.cg-due')?.textContent?.trim()).toBe('—');
    (row.querySelector('[data-action="bench"]') as HTMLElement).click();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/lab/culture', 'ot-1']);
  });

  it('every data column sorts AND filters on its real value (owner 2026-11-21); Open never', async () => {
    render(true);
    const c = (fixture as unknown as { componentInstance: CulturePanelComponent }).componentInstance;
    const by = Object.fromEntries(c.cols().map(d => [d.colId, d]));
    for (const k of ['sample', 'patient', 'test', 'day', 'next', 'due']) {
      expect(by[k].sortable, k).toBe(true);
      expect(by[k].sortingOrder, k).toEqual(['asc', 'desc', null]);
      expect(typeof by[k].comparator, k).toBe('function');
      expect(by[k].filter, k).toBeTruthy();
    }
    expect(by['acts'].sortable).toBe(false);
    expect(by['due'].filter).toBe('agNumberColumnFilter');
  });

  it('classic keeps its stripe and arrow', () => {
    const el = render(false);
    expect(el.querySelector('.pf-cc__cap')).toBeTruthy();
    expect(el.querySelector('.pf-cc--nd')).toBeNull();
  });

  it('new-design tile rules: ID is 16.5/600 primary; the next-step dot is the only accent', () => {
    const css = ((CulturePanelComponent as any).ɵcmp.styles as string[]).join('\n');
    expect(css).toMatch(/\.pf-cc--nd[^{]*\.pf-cc__id[^{]*\{[^}]*font-size:\s*16\.5px[^}]*font-weight:\s*600/);
    const nd = css.slice(css.indexOf('.pf-cc--nd'));
    expect(nd).not.toMatch(/#22d3ee|#0e7490|#b45309|#34d399/i);
  });
});
