import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
import { SessionService } from '../../../core/auth/session.service';
import { DialogService } from '../../../core/services/dialog.service';
import { PracticeApi } from './practice-api';
import { CsSettingsPage } from './cs-settings.page';

/** PracticeApi — PORTED from prefrontal-prepare-ui http-cases-api.spec.ts ("practice settings: …"), paths renamed. */
describe('PracticeApi', () => {
  let api: PracticeApi;
  let http: HttpTestingController;
  const B = `${environment.apiUrl}/api/casesheets`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(PracticeApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('practice settings: nulls ↔ empty strings, file links made absolute, pictures as raw bodies', async () => {
    const g = api.getPractice();
    http.expectOne(`${B}/practice-settings`).flush({
      practiceName: null,
      doctorName: 'Dr Meera',
      enabled: true,
      logo: { url: '/api/casesheets/practice-settings/logo?v=a', width: 10, height: 5 },
      signature: null,
    });
    const s = await g;
    expect(s.practiceName).toBe('');
    expect(s.logo?.url).toBe(`${environment.apiUrl}/api/casesheets/practice-settings/logo?v=a`);

    const put = api.savePractice({ ...s, practiceName: '  ', phone: '+91 1' });
    const pr = http.expectOne(`${B}/practice-settings`);
    expect(pr.request.method).toBe('PUT');
    expect(pr.request.body).toMatchObject({ practiceName: null, doctorName: 'Dr Meera', phone: '+91 1', enabled: true });
    expect('logo' in pr.request.body).toBe(false);
    pr.flush({ doctorName: 'Dr Meera', enabled: true });
    await put;

    const png = new Blob(['x'], { type: 'image/png' });
    const up = api.uploadPracticeImage('signature', png);
    const ur = http.expectOne(`${B}/practice-settings/signature`);
    expect(ur.request.method).toBe('PUT');
    expect(ur.request.body).toBe(png);
    expect(ur.request.headers.get('Content-Type')).toBe('image/png');
    ur.flush({ signature: { url: '/api/casesheets/practice-settings/signature?v=s' } });
    expect((await up).signature?.url).toBe(`${environment.apiUrl}/api/casesheets/practice-settings/signature?v=s`);

    const rm = api.removePracticeImage('logo');
    http.expectOne(`${B}/practice-settings/logo`).flush(null, { status: 204, statusText: 'No Content' });
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne(`${B}/practice-settings`).flush({ logo: null });
    expect((await rm).logo).toBeNull();
  });
});

describe('Settings (case-sheet site)', () => {
  function render(kind: 'personal' | 'lab') {
    TestBed.resetTestingModule();
    const confirm = vi.fn(async () => true);
    const logout = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: {
          user: signal({ id: 'u', displayName: 'Dr Meera R', email: 'meera@gmail.com', tenantName: 'Micro World',
            tenantKind: kind === 'personal' ? 'personal' : undefined }),
        } },
        { provide: DialogService, useValue: { confirm } },
        { provide: SessionService, useValue: { logout } },
      ],
    });
    const f = TestBed.createComponent(CsSettingsPage);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, confirm, logout, http: TestBed.inject(HttpTestingController) };
  }

  it('personal space: profile, appearance and the practice header / logo / signature card', () => {
    const { el, http } = render('personal');
    expect(el.querySelector('[data-testid="profile-name"]')?.textContent).toContain('Dr Meera R');
    expect(el.textContent).toContain('Appearance');
    expect(el.querySelector('pf-cs-practice-card')).toBeTruthy();
    http.expectOne(`${environment.apiUrl}/api/casesheets/practice-settings`).flush({ doctorName: 'Dr Meera', enabled: true });
    expect(el.textContent).not.toMatch(/\bAI\b/);
  });

  it('lab user: no practice card (the lab’s PDFs carry the lab’s branding), no practice call', () => {
    const { el, http } = render('lab');
    expect(el.querySelector('pf-cs-practice-card')).toBeNull();
    expect(el.textContent).toContain('Case sheets at Micro World');
    http.expectNone(`${environment.apiUrl}/api/casesheets/practice-settings`);
  });

  it('Sign out asks first (DialogService), then runs the ONE sign-out sequence', async () => {
    const { el, f, confirm, logout } = render('lab');
    (el.querySelector('[data-testid="sign-out"]') as HTMLButtonElement).click();
    await f.whenStable();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe('PracticeCardComponent pictures (session only, no links)', () => {
  it('fetches the logo bytes with HttpClient as a blob and shows an object URL; revokes it when the card goes', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:logo-${created.length + 1}`; created.push(u); return u; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: DialogService, useValue: { confirm: vi.fn() } }],
    });
    const { PracticeCardComponent } = await import('./practice-card.component');
    const f = TestBed.createComponent(PracticeCardComponent);
    const http = TestBed.inject(HttpTestingController);
    const B = `${environment.apiUrl}/api/casesheets`;
    http.expectOne(`${B}/practice-settings`).flush({ enabled: true, logo: { url: '/api/casesheets/practice-settings/logo?v=a', width: 10, height: 5 }, signature: null });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    f.detectChanges();
    const bytes = http.expectOne(`${B}/practice-settings/logo?v=a`);
    expect(bytes.request.responseType).toBe('blob');
    bytes.flush(new Blob(['png'], { type: 'image/png' }));
    for (let i = 0; i < 4; i++) await Promise.resolve();
    f.detectChanges();
    const img = (f.nativeElement as HTMLElement).querySelector<HTMLImageElement>('[data-image="logo"] img')!;
    expect(img.getAttribute('src')).toBe('blob:logo-1');
    http.expectNone((r) => r.url.includes('/api/casesheets/files'));
    f.destroy();
    expect(revoked).toEqual(['blob:logo-1']);
    vi.restoreAllMocks();
  });
});
