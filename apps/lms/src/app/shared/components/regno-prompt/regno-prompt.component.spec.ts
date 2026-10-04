import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { MySignatureComponent } from '../../../features/user-signature/my-signature.component';
import { REGNO_PROMPT_TEXT, RegnoPromptComponent, needsRegistrationNumber } from './regno-prompt.component';

/**
 * Doctor registration number (owner 2026-09-29: "If the admin has missed the
 * doctor registration number, the doctor can feed it"). A signing user
 * (validate_result) with no number sees the gentle prompt; it links to My
 * signature → Registration ID, where they save it themselves.
 */
type U = { permissions: string[]; registrationId?: string | null };

function renderPrompt(user: U | null) {
  const u = signal<U | null>(user);
  TestBed.configureTestingModule({
    imports: [RegnoPromptComponent],
    providers: [provideRouter([]), { provide: AuthService, useValue: { user: u } }],
  });
  const f = TestBed.createComponent(RegnoPromptComponent);
  f.detectChanges();
  return { f, u, el: f.nativeElement as HTMLElement };
}

afterEach(() => TestBed.resetTestingModule());

describe('needsRegistrationNumber', () => {
  it('only a signing user with no number needs it', () => {
    expect(needsRegistrationNumber({ permissions: ['validate_result'], registrationId: null })).toBe(true);
    expect(needsRegistrationNumber({ permissions: ['validate_result'], registrationId: '   ' })).toBe(true);
    expect(needsRegistrationNumber({ permissions: ['*'] })).toBe(true);
    expect(needsRegistrationNumber({ permissions: ['validate_result'], registrationId: 'TN-1' })).toBe(false);
    expect(needsRegistrationNumber({ permissions: ['enter_result', 'register_patient'] })).toBe(false);
    expect(needsRegistrationNumber(null)).toBe(false);
  });
});

describe('pf-regno-prompt', () => {
  it('shows the prompt with an SVG icon and an Add link to My signature → Registration ID when missing', () => {
    const { el } = renderPrompt({ permissions: ['validate_result'], registrationId: null });
    const box = el.querySelector('.pf-regno')!;
    expect(box).not.toBeNull();
    expect(box.textContent).toContain(REGNO_PROMPT_TEXT);
    expect(box.querySelector('svg')).not.toBeNull();
    const a = box.querySelector('a.pf-regno__cta') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/signature?tab=registration');
  });

  it('renders nothing for a non-signer, and disappears once the number is saved', () => {
    const tech = renderPrompt({ permissions: ['enter_result'] });
    expect(tech.el.querySelector('.pf-regno')).toBeNull();
    TestBed.resetTestingModule();

    const doc = renderPrompt({ permissions: ['validate_result'], registrationId: '' });
    expect(doc.el.querySelector('.pf-regno')).not.toBeNull();
    doc.u.set({ permissions: ['validate_result'], registrationId: 'MCI-7' });
    doc.f.detectChanges();
    expect(doc.el.querySelector('.pf-regno')).toBeNull();
  });
});

describe('My signature — the doctor fills their own registration number', () => {
  function renderSig(regId: string | null, tab?: string) {
    document.documentElement.classList.add('design-new');
    const user = signal<any>({ tenantName: 'Micro World', permissions: ['validate_result'], registrationId: regId });
    const auth = {
      user,
      setRegistrationIdLocal: vi.fn((v: string | null) => user.update(u => ({ ...u, registrationId: v ?? undefined }))),
      setSignatureLocal: vi.fn(),
    };
    const api = { put: vi.fn(() => of({ registrationId: 'MCI-2026-01' })), delete: vi.fn(() => of({})), get: vi.fn(() => of([])) };
    TestBed.configureTestingModule({
      imports: [MySignatureComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
        { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map(tab ? [['tab', tab]] : []) } } },
      ],
    });
    const f = TestBed.createComponent(MySignatureComponent);
    f.detectChanges();
    return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement, api, auth };
  }

  it('the prompt link opens straight on Registration ID and says why it matters when empty', () => {
    const { c, el } = renderSig(null, 'registration');
    expect(c.tab()).toBe('registration');
    expect(el.querySelector('.pf-sig-regprompt')!.textContent).toContain(REGNO_PROMPT_TEXT);
  });

  it('saving calls the self endpoint (own row only) and updates the profile in place', () => {
    const { c, f, el, api, auth } = renderSig(null, 'registration');
    c.regId.set(' MCI-2026-01 ');
    c.saveRegId();
    expect(api.put).toHaveBeenCalledWith('/api/auth/me/registration-id', { registrationId: 'MCI-2026-01' });
    expect(auth.setRegistrationIdLocal).toHaveBeenCalledWith('MCI-2026-01');
    f.detectChanges();
    expect(el.querySelector('.pf-sig-regprompt')).toBeNull();
  });

  it('opens on Signature by default and shows no prompt once a number exists', () => {
    const { c, el } = renderSig('TN-1');
    expect(c.tab()).toBe('signature');
    c.tab.set('registration');
    expect(el.querySelector('.pf-sig-regprompt')).toBeNull();
  });
});
