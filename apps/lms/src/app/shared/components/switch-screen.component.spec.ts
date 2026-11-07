import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { SwitchScreenComponent } from './switch-screen.component';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService, StoredAccount } from '../../core/auth/accounts.service';
import { LockService } from '../../core/auth/lock.service';

/** Owner 2026-09-27: "This profile's session has expired" was a dead end.
 *  An expired profile now offers an inline, tenant-locked sign-in. */
const ADMIN: StoredAccount = {
  userId: 'app-admin', org: 'Micro World', tenantId: 't1', displayName: 'Admin User',
  email: 'admin@t1.tenant.prefrontal', accessToken: 'a', refreshToken: 'r', hasPin: true, addedAt: '',
};

function setup(switchImpl: () => Promise<void>) {
  const switchTarget = signal<StoredAccount | null>(null);
  TestBed.configureTestingModule({
    imports: [SwitchScreenComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { switchAccount: vi.fn(switchImpl), user: signal({ displayName: 'Frontdesk' }) } },
      { provide: AccountsService, useValue: { initials: () => 'AU', setHasPin: vi.fn() } },
      { provide: LockService, useValue: { switchTarget } },
    ],
  });
  const f = TestBed.createComponent(SwitchScreenComponent);
  f.detectChanges();
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { f, el: f.nativeElement as HTMLElement, switchTarget, nav };
}

describe('SwitchScreenComponent — expired saved sign-in', () => {
  it('a profile already flagged expired skips the PIN and offers "Sign in as Admin"', () => {
    const t = setup(async () => undefined);
    t.switchTarget.set({ ...ADMIN, expired: true });
    t.f.detectChanges();
    TestBed.tick();
    t.f.detectChanges();
    expect(t.el.querySelector('pf-pin-dots')).toBeNull();
    const btn = t.el.querySelector('[data-testid="switch-sign-in-again"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Sign in as Admin');
    btn.click();
    expect(t.nav).toHaveBeenCalledWith(['/login'], { queryParams: { add: '1', username: 'admin' } });
    expect(t.switchTarget()).toBeNull();
  });

  it('a session_expired error from the switch turns into the same recovery (no dead end)', async () => {
    const t = setup(async () => { throw Object.assign(new Error('Admin’s saved sign-in has ended on this device — sign in again to switch.'), { code: 'session_expired' }); });
    t.switchTarget.set({ ...ADMIN, hasPin: true });
    t.f.detectChanges();
    TestBed.tick();
    await (t.f.componentInstance as unknown as { attempt(p: string): Promise<void> }).attempt('1234');
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    t.f.detectChanges();
    expect(t.el.textContent).toContain('saved sign-in has ended');
    expect(t.el.querySelector('[data-testid="switch-sign-in-again"]')).not.toBeNull();
    expect(t.el.textContent).toContain('Cancel — stay as Frontdesk');
    // One attempt only — no retry loop (busy() used to be tracked by the effect).
    expect((TestBed.inject(AuthService) as unknown as { switchAccount: { mock: { calls: unknown[] } } }).switchAccount.mock.calls.length).toBe(1);
  });
});

describe('SwitchScreenComponent — OPS-26 PIN-less target', () => {
  it('never opens the profile directly: no switch attempt, sign-in with password offered', () => {
    const t = setup(async () => undefined);
    t.switchTarget.set({ ...ADMIN, hasPin: false });
    t.f.detectChanges();
    TestBed.tick();
    t.f.detectChanges();
    expect((TestBed.inject(AuthService) as unknown as { switchAccount: { mock: { calls: unknown[] } } }).switchAccount.mock.calls.length).toBe(0);
    expect(t.el.querySelector('pf-pin-dots')).toBeNull();
    expect(t.el.textContent).toContain('has no PIN');
    expect(t.el.querySelector('[data-testid="switch-sign-in-again"]')).not.toBeNull();
  });
});
