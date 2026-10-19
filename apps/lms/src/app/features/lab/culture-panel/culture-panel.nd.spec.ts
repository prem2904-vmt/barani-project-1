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
  return f.nativeElement as HTMLElement;
}

describe('Culture tiles — new design', () => {
  it('have no left stripe and the sample ID as the primary line', () => {
    const el = render(true);
    const tile = el.querySelector('li.pf-cc')!;
    expect(tile.classList.contains('pf-cc--nd')).toBe(true);
    expect(tile.querySelector('.pf-cc__cap')).toBeNull();
    const main = tile.querySelector('.pf-cc__main')!;
    expect(main.querySelector('.pf-cc__id')?.textContent?.trim()).toBe('MICRO26001');
    expect(main.querySelector('.pf-cc__who')?.textContent?.trim()).toBe('Mrs. Shanthi M');
    expect(main.querySelector('.pf-cc__sub')?.textContent).toContain('Bacterial Culture & Sensitivity');
    expect(tile.querySelector('.pf-cc__now')?.textContent).toContain('Next: Gram / Direct smear');
    expect(tile.querySelector('svg.pf-cc__chev')).toBeTruthy();
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
