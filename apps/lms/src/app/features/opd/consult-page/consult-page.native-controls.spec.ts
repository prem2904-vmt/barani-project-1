import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ConsultPageComponent } from './consult-page.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';

/** Consulting doctor used a native `<select>` — now `pf-select`. */
describe('Consult page — consulting doctor (no native select)', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [ConsultPageComponent],
      providers: [
        { provide: ApiService, useValue: { get: vi.fn(() => of([])), post: vi.fn(() => of({})) } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
        { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn(), backTo: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) }, paramMap: of(convertToParamMap({})), queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(ConsultPageComponent);
    const c = f.componentInstance as any;
    c.doctors.set([
      { id: 'd1', name: 'Dr Meena Rao', department: 'Cardiology', fee: 500 },
      { id: 'd2', name: 'Dr Arun Kumar', department: 'Paediatrics', fee: 300 },
    ]);
    f.detectChanges();
    return { f, c, el: f.nativeElement as HTMLElement };
  }

  it('renders pf-select for the doctor picker, never a native select', () => {
    const { el } = render();
    expect(el.querySelector('pf-select')).not.toBeNull();
    expect(el.querySelector('select')).toBeNull();
  });

  it('picking a doctor sets doctorId and auto-fills their default fee', () => {
    const { c } = render();
    c.onDoctor('d2');
    expect(c.doctorId()).toBe('d2');
    expect(c.fee()).toBe(300);
  });
});
