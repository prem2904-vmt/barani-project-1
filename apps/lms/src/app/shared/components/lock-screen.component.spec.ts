import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { LockScreenComponent } from './lock-screen.component';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService, StoredAccount } from '../../core/auth/accounts.service';
import { LockService } from '../../core/auth/lock.service';

const mk = (userId: string, hasPin: boolean): StoredAccount => ({
  userId, org: 'Micro World', tenantId: 't1', displayName: `${userId} User`, email: `${userId}@t1.tenant.prefrontal`,
  accessToken: 'a', refreshToken: 'r', hasPin, addedAt: '',
});

describe('LockScreenComponent — OPS-26 PIN-less profile', () => {
  it('picking someone else without a PIN never switches; their password is offered', async () => {
    const switchAccount = vi.fn(async () => undefined);
    const abandonToLogin = vi.fn();
    TestBed.configureTestingModule({
      imports: [LockScreenComponent],
      providers: [
        { provide: AuthService, useValue: { switchAccount, user: signal({ id: 'me' }), isAuthenticated: () => true } },
        { provide: AccountsService, useValue: { accounts: signal([]), initials: () => 'X', setHasPin: vi.fn() } },
        { provide: LockService, useValue: { locked: () => true, abandonToLogin, clearAfterSwitch: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(LockScreenComponent);
    f.componentInstance.select(mk('other', false));
    f.detectChanges();
    await Promise.resolve();
    const el = f.nativeElement as HTMLElement;
    expect(switchAccount).not.toHaveBeenCalled();
    expect(el.querySelector('pf-pin-dots')).toBeNull();
    expect(el.querySelector('[data-testid="lock-no-pin"]')?.textContent).toContain('has no PIN');
    (el.querySelector('[data-testid="lock-sign-in"]') as HTMLButtonElement).click();
    expect(abandonToLogin).toHaveBeenCalled();
  });

  it('a profile WITH a PIN asks for it', () => {
    TestBed.configureTestingModule({
      imports: [LockScreenComponent],
      providers: [
        { provide: AuthService, useValue: { switchAccount: vi.fn(), user: signal({ id: 'me' }), isAuthenticated: () => true } },
        { provide: AccountsService, useValue: { accounts: signal([]), initials: () => 'X', setHasPin: vi.fn() } },
        { provide: LockService, useValue: { locked: () => true, abandonToLogin: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(LockScreenComponent);
    f.componentInstance.select(mk('other', true));
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('pf-pin-dots')).not.toBeNull();
  });
});
