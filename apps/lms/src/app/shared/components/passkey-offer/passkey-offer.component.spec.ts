import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PasskeyOfferComponent } from './passkey-offer.component';
import { AuthService } from '../../../core/auth/auth.service';
import { PasskeyService } from '../../../core/auth/passkey.service';
import { PASSKEY_OFFER_SEEN_PREFIX, PasskeyOfferService } from '../../../core/auth/passkey-offer';
import { PasskeyError } from '../../../core/auth/passkey-webauthn';
import { ToastService } from '../../../core/services/toast.service';

@Component({ template: '' })
class BlankComponent {}

function memStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

async function render(o: { available?: boolean; register?: () => Promise<unknown>; pending?: boolean } = {}) {
  TestBed.resetTestingModule();
  const store = memStorage();
  vi.stubGlobal('localStorage', store);
  const user = signal<{ id: string } | null>({ id: 'u1' });
  const passkeys = { available: () => o.available ?? true, register: vi.fn(o.register ?? (async () => ({ id: 'pk' }))) };
  const toasts = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    imports: [PasskeyOfferComponent],
    providers: [
      provideRouter([{ path: '', component: BlankComponent }, { path: 'security', component: BlankComponent }]),
      { provide: AuthService, useValue: { user, mustChangePassword: () => false } },
      { provide: PasskeyService, useValue: passkeys },
      { provide: ToastService, useValue: toasts },
    ],
  });
  await TestBed.inject(Router).navigateByUrl('/');
  const offer = TestBed.inject(PasskeyOfferService);
  if (o.pending !== false) offer.offer('u1');
  const fixture = TestBed.createComponent(PasskeyOfferComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, store, passkeys, toasts, offer, user };
}

afterEach(() => vi.unstubAllGlobals());

describe('PasskeyOfferComponent', () => {
  it('shows the optional card and marks it seen the moment it appears (once per user per device)', async () => {
    const { el, store } = await render();
    expect(el.querySelector('[data-testid="passkey-offer"]')?.textContent).toContain('fingerprint or face');
    expect(el.textContent).toContain('not on a shared lab computer');
    expect(store.m.get(PASSKEY_OFFER_SEEN_PREFIX + 'u1')).toBe('1');
  });

  it('renders nothing without a pending offer or where passkeys are unavailable', async () => {
    expect((await render({ pending: false })).el.querySelector('[data-testid="passkey-offer"]')).toBeNull();
    expect((await render({ available: false })).el.querySelector('[data-testid="passkey-offer"]')).toBeNull();
  });

  it('"Not now" dismisses it without creating anything', async () => {
    const { el, fixture, passkeys, offer } = await render();
    (el.querySelector('[data-testid="passkey-offer-dismiss"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="passkey-offer"]')).toBeNull();
    expect(passkeys.register).not.toHaveBeenCalled();
    expect(offer.pending()).toBeNull();
  });

  it('"Set up" registers a passkey, then hides with a toast', async () => {
    const { el, fixture, passkeys, toasts } = await render();
    (el.querySelector('[data-testid="passkey-offer-setup"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(passkeys.register).toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="passkey-offer"]')).toBeNull();
  });

  it('a cancelled set-up stays open with plain words', async () => {
    const { el, fixture } = await render({ register: async () => { throw new PasskeyError('cancelled'); } });
    (el.querySelector('[data-testid="passkey-offer-setup"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.pf-pko__error')?.textContent).toContain('Passkey not added');
  });

  it('another person signing in drops the offer', async () => {
    const { fixture, offer, user } = await render();
    user.set({ id: 'u2' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(offer.pending()).toBeNull();
  });
});
