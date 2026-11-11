import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { CasesheetGateService } from '../casesheets/shared/casesheet-gate.service';
import { CaseSheetBuilderApi } from '../casesheets/studio/builder/builder-api';
import { BuilderError, BuilderStatus } from '../casesheets/studio/builder/builder-models';
import { CORTEX_BUILDER_ON } from '../casesheets/studio/builder/builder-status.service';
import { fakeApi } from '../casesheets/studio/builder/builder-testing';
import { AiConnectorApi } from './ai-connector.api';
import { AiConnectorsSettingsPage } from './ai-connectors-settings.page';

const STATE = { enabled: true, connectorUrl: 'https://x/mcp', labName: 'Micro World' };

function setup(o: { flag?: boolean; gate?: boolean; status?: BuilderStatus; confirm?: boolean } = {}) {
  const status: BuilderStatus = o.status ?? { cortex: true, connector: false, connectorSwitch: false, canChangeSwitch: true };
  const builder = fakeApi();
  builder.status.mockResolvedValue(status);
  const dialog = { confirm: vi.fn(async (_r?: unknown) => o.confirm ?? true), alert: vi.fn(async (_r?: unknown) => undefined) };
  const toasts = { success: vi.fn(), error: vi.fn() };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiConnectorsSettingsPage],
    providers: [
      provideRouter([]),
      { provide: AiConnectorApi, useValue: { get: () => of(STATE), listGrants: () => of([]) } },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }), hasAnyPermission: () => true } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: CORTEX_BUILDER_ON, useValue: () => o.flag ?? true },
      { provide: CasesheetGateService, useValue: { visible: () => o.gate ?? true } },
      { provide: CaseSheetBuilderApi, useValue: builder },
    ],
  });
  const f = TestBed.createComponent(AiConnectorsSettingsPage);
  document.body.appendChild(f.nativeElement);
  return { f, builder, dialog, toasts };
}

async function loaded(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  f.detectChanges();
  await new Promise((r) => setTimeout(r, 650));
  for (let i = 0; i < 4; i++) { f.detectChanges(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }
  await f.whenStable();
  f.detectChanges();
}
const row = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('[data-builder-switch]');
const btn = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelector('#pf-aic-builder') as HTMLButtonElement | null;

afterEach(() => { document.body.innerHTML = ''; });

describe('AI connector settings: "Let connected apps build case sheet forms"', () => {
  it('shows the row with its plain explanation when the switch is on, the case-sheet gate is open and the server allows changing it', async () => {
    const { f } = setup();
    await loaded(f);
    expect(row(f)).not.toBeNull();
    const text = row(f)!.textContent!;
    expect(text).toContain('Let connected apps build case sheet forms');
    expect(text).toContain('DRAFT case sheet forms');
    expect(text).toMatch(/nothing is published without you/i);
    expect(btn(f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('console flag off: no row, and the builder is never asked', async () => {
    const { f, builder } = setup({ flag: false });
    await loaded(f);
    expect(row(f)).toBeNull();
    expect(builder.status).not.toHaveBeenCalled();
  });

  it('case-sheet gate closed, or the server says the person cannot change it: no row', async () => {
    const a = setup({ gate: false });
    await loaded(a.f);
    expect(row(a.f)).toBeNull();
    const b = setup({ status: { cortex: true, connector: false, connectorSwitch: false, canChangeSwitch: false } });
    await loaded(b.f);
    expect(row(b.f)).toBeNull();
  });

  it('turning it on asks first (DialogService), then PUTs {enabled:true} and the switch reads on', async () => {
    const { f, builder, dialog, toasts } = setup();
    await loaded(f);
    btn(f)!.click();
    await loaded(f);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(builder.setConnector).toHaveBeenCalledWith(true);
    expect(btn(f)!.getAttribute('aria-checked')).toBe('true');
    expect(toasts.success).toHaveBeenCalled();
  });

  it('cancelling the confirm changes nothing', async () => {
    const { f, builder } = setup({ confirm: false });
    await loaded(f);
    btn(f)!.click();
    await loaded(f);
    expect(builder.setConnector).not.toHaveBeenCalled();
    expect(btn(f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('turning it off from on sends {enabled:false}', async () => {
    const { f, builder } = setup({ status: { cortex: true, connector: true, connectorSwitch: true, canChangeSwitch: true } });
    await loaded(f);
    expect(btn(f)!.getAttribute('aria-checked')).toBe('true');
    btn(f)!.click();
    await loaded(f);
    expect(builder.setConnector).toHaveBeenCalledWith(false);
    expect(btn(f)!.getAttribute('aria-checked')).toBe('false');
  });

  it('a refused save says so in words and the switch does not move', async () => {
    const { f, builder, toasts } = setup();
    builder.setConnector.mockRejectedValueOnce(new BuilderError('feature_off', 'Cortex form building is switched off for your lab.', 403));
    await loaded(f);
    btn(f)!.click();
    await loaded(f);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('switched off'));
    expect(btn(f)!.getAttribute('aria-checked')).toBe('false');
  });
});
