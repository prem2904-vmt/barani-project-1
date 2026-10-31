import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PasskeysComponent, passkeyDate, passkeyMeta } from './passkeys.component';
import { PasskeyItem, PasskeyService } from '../../core/auth/passkey.service';
import { PasskeyError } from '../../core/auth/passkey-webauthn';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';

/** Account → Passkeys: add on this device, list, rename, remove (DialogService), shared-PC warning. */
const ITEMS: PasskeyItem[] = [
  { id: 'pk-1', friendlyName: 'Chrome on Mac', createdAt: '2026-10-01T04:00:00Z', lastUsedAt: '2026-10-30T20:00:00Z' },
  { id: 'pk-2', friendlyName: null, createdAt: '2026-10-20T04:00:00Z', lastUsedAt: null },
];

async function render(o: { enabled?: boolean; available?: boolean; reason?: string; confirm?: boolean; items?: PasskeyItem[]; register?: () => Promise<PasskeyItem> } = {}) {
  TestBed.resetTestingModule();
  const passkeys = {
    enabled: () => o.enabled ?? true,
    available: () => o.available ?? true,
    availability: () => ({ ok: o.available ?? true, reason: o.reason ?? null }),
    list: vi.fn(async () => (o.items ?? ITEMS).map(x => ({ ...x }))),
    register: vi.fn(o.register ?? (async () => ({ id: 'pk-3', friendlyName: 'Safari on iPhone', createdAt: '2026-10-31T04:00:00Z', lastUsedAt: null }))),
    rename: vi.fn(async (id: string, name: string) => ({ id, friendlyName: name, createdAt: '', lastUsedAt: null })),
    remove: vi.fn(async () => undefined),
  };
  const dialog = { confirm: vi.fn(async () => o.confirm ?? true), prompt: vi.fn(async () => 'Desk PC') };
  const toasts = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    imports: [PasskeysComponent],
    providers: [
      provideRouter([]),
      { provide: PasskeyService, useValue: passkeys },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: ThemeService, useValue: { isNewDesign: () => false } },
    ],
  });
  const fixture = TestBed.createComponent(PasskeysComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => { await fixture.whenStable(); fixture.detectChanges(); };
  return { fixture, el, passkeys, dialog, toasts, settle };
}

describe('PasskeysComponent', () => {
  it('lists every passkey with name, added and last-used dates (IST)', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('[data-testid="passkey-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Chrome on Mac');
    expect(rows[0].textContent).toContain('Added 1 Oct 2026');
    expect(rows[0].textContent).toContain('Last used 31 Oct 2026');   // 20:00Z = next day in IST
    expect(rows[1].textContent).toContain('Not used yet');
  });

  it('warns in plain words never to add a passkey on a shared computer login', async () => {
    const { el } = await render();
    expect(el.querySelector('[data-testid="passkey-shared-warning"]')?.textContent).toMatch(/shared lab computer|shared computer login/);
  });

  it('adds a passkey on this device and shows it in the list', async () => {
    const { el, passkeys, toasts, settle } = await render({ items: [] });
    expect(el.querySelector('[data-testid="passkey-empty"]')).toBeTruthy();
    (el.querySelector('[data-testid="passkey-add"]') as HTMLButtonElement).click();
    await settle();
    expect(passkeys.register).toHaveBeenCalled();
    expect(el.querySelectorAll('[data-testid="passkey-row"]')).toHaveLength(1);
    expect(toasts.success).toHaveBeenCalled();
  });

  it('a failed add explains itself (cancel)', async () => {
    const { el, settle } = await render({ register: async () => { throw new PasskeyError('cancelled'); } });
    (el.querySelector('[data-testid="passkey-add"]') as HTMLButtonElement).click();
    await settle();
    expect(el.textContent).toContain('Passkey not added');
  });

  it('remove asks first (DialogService) and only removes on confirm', async () => {
    const no = await render({ confirm: false });
    (no.el.querySelector('[data-testid="passkey-remove"]') as HTMLButtonElement).click();
    await no.settle();
    expect(no.dialog.confirm).toHaveBeenCalled();
    expect(no.passkeys.remove).not.toHaveBeenCalled();

    const yes = await render({ confirm: true });
    (yes.el.querySelector('[data-testid="passkey-remove"]') as HTMLButtonElement).click();
    await yes.settle();
    expect(yes.passkeys.remove).toHaveBeenCalledWith('pk-1');
    expect(yes.el.querySelectorAll('[data-testid="passkey-row"]')).toHaveLength(1);
  });

  it('rename prompts through DialogService (no native prompt)', async () => {
    const { el, passkeys, dialog, settle } = await render();
    (el.querySelector('[aria-label="Rename Chrome on Mac"]') as HTMLButtonElement).click();
    await settle();
    expect(dialog.prompt).toHaveBeenCalled();
    expect(passkeys.rename).toHaveBeenCalledWith('pk-1', 'Desk PC');
    expect(el.textContent).toContain('Desk PC');
  });

  it('desktop app: lists / removes but explains why it can’t add here', async () => {
    const { el } = await render({ available: false, reason: 'desktop' });
    expect(el.querySelector('[data-testid="passkey-add"]')).toBeNull();
    expect(el.querySelector('[data-testid="passkey-add-unavailable"]')?.textContent).toContain('desktop lab app');
    expect(el.querySelectorAll('[data-testid="passkey-row"]')).toHaveLength(2);
  });

  it('beta off: nothing about passkeys loads', async () => {
    const { el, passkeys } = await render({ enabled: false });
    expect(passkeys.list).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="passkey-row"]')).toBeNull();
  });

  it('formats dates in IST and the meta line', () => {
    expect(passkeyDate('2026-10-30T20:00:00Z')).toBe('31 Oct 2026');
    expect(passkeyDate(null)).toBe('');
    expect(passkeyMeta(ITEMS[1])).toBe('Added 20 Oct 2026 · Not used yet');
  });
});
