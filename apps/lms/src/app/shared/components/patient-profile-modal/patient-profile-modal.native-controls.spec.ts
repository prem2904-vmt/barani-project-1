import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { PatientProfileModalComponent } from './patient-profile-modal.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { PatientProfileService } from '../../../core/services/patient-profile.service';
import { ToastService } from '../../../core/services/toast.service';

/** Edit panel's Date of birth used a native `<input type="date">` — now
 *  `pf-date`, same `dateOfBirth` (yyyy-MM-dd) the save payload reads. */
describe('Patient profile modal — edit DOB (no native date input)', () => {
  const patient = {
    id: 'p1', title: 'Mr', firstName: 'Ravi', fathersName: 'Kumar',
    dateOfBirth: '1990-05-15', sex: 'male', mrn: 'AA0001',
  };

  function render() {
    const api = { get: vi.fn(() => of({ patient, history: [] })) };
    TestBed.configureTestingModule({
      imports: [PatientProfileModalComponent],
      providers: [
        provideHttpClient(),
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
        { provide: AuthService, useValue: { user: () => ({ permissions: [] }), hasPermission: () => true } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(PatientProfileModalComponent);
    f.detectChanges();
    const profile = TestBed.inject(PatientProfileService);
    profile.open('p1');
    f.detectChanges();
    const c = f.componentInstance as any;
    c.enterEdit();
    f.detectChanges();
    return { f, c, el: f.nativeElement as HTMLElement };
  }

  it('renders pf-date for Date of birth, never a visible native date input', () => {
    const { el } = render();
    expect(el.querySelector('pf-date')).not.toBeNull();
    expect(el.querySelector('input[type="date"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('typing a DOB sets draft().dateOfBirth as plain ISO yyyy-MM-dd', () => {
    const { el, c } = render();
    const txt = el.querySelector<HTMLInputElement>('pf-date input[type="text"]')!;
    txt.value = '15051990';
    txt.dispatchEvent(new Event('input'));
    expect(c.draft().dateOfBirth).toBe('1990-05-15');
  });
});
