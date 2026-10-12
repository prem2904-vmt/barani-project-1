import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AdvancedPatientSearchComponent } from './advanced-patient-search.component';
import { ApiService } from '../../../core/services/api.service';

/** Visit-date "Custom…" range used two native `<input type="date">` —
 *  now `pf-date`, same ISO yyyy-MM-dd the server-side filter reads. */
function render() {
  const api = { get: vi.fn(() => of([])) };
  TestBed.configureTestingModule({
    imports: [AdvancedPatientSearchComponent],
    providers: [{ provide: ApiService, useValue: api }],
  });
  const f = TestBed.createComponent(AdvancedPatientSearchComponent);
  f.componentRef.setInput('open', true);
  f.detectChanges();
  const c = f.componentInstance as any;
  c.setDatePreset('custom');
  f.detectChanges();
  const root = () => document.querySelector('.pf-aps-root') as HTMLElement;
  return { f, c, root };
}

describe('Advanced patient search — custom date range (no native date input)', () => {
  afterEach(() => document.querySelectorAll('.pf-aps-root').forEach(n => n.remove()));

  it('renders two pf-date fields, never a native date input', () => {
    const { root } = render();
    const range = root().querySelector('.pf-aps-custom-range')!;
    expect(range.querySelectorAll('pf-date').length).toBe(2);
    expect(range.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('typing From/To sets filters().dateFrom/dateTo as plain ISO strings', () => {
    const { root, c } = render();
    const [from, to] = Array.from(root().querySelectorAll<HTMLInputElement>('.pf-aps-custom-range pf-date input[type="text"]'));
    from.value = '01092026'; from.dispatchEvent(new Event('input'));
    to.value = '30092026'; to.dispatchEvent(new Event('input'));
    expect(c.filters().dateFrom).toBe('2026-09-01');
    expect(c.filters().dateTo).toBe('2026-09-30');
  });
});
