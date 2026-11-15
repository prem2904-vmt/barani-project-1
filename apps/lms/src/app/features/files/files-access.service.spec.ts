import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { DeviceClassService } from '../../core/services/device-class.service';
import { TenantEntitlementsService, filesFullOn } from '../../core/services/tenant-entitlements.service';
import { FilesAccessService } from './files-access.service';
import { OfficeService } from './office.service';
import { FILES_APPS } from './files-registry';

const [NEURON, SYNAPSE, AXON, MYELIN] = FILES_APPS;
const access = (over: Record<string, unknown> = {}) => ({
  apps: { sheet: { enabled: true, canRead: true, canWrite: true }, doc: { enabled: true, canRead: true, canWrite: true }, slides: { enabled: false, canRead: false, canWrite: false },
    pdf: { enabled: true, canRead: true, canWrite: false }, image: { enabled: true, canRead: true, canWrite: true }, ...(over['apps'] as object) },
  editOnPhones: false, trashDays: 30, patientNames: true, canManage: true, full: true, ...over, });

function make(o: { beta?: boolean; user?: boolean; full?: boolean; phone?: boolean; perms?: string[]; acc?: ReturnType<typeof access>; fail?: boolean } = {}) {
  const full = signal(o.full !== false);
  const office = { settings: vi.fn(async () => { if (o.fail) throw new Error('x'); return { settings: {}, access: o.acc ?? access() }; }) };
  const perms = o.perms ?? ['view_report', 'enter_result'];
  TestBed.configureTestingModule({ providers: [
    { provide: OfficeService, useValue: office },
    { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'neuron' && o.beta !== false } },
    { provide: AuthService, useValue: { user: signal(o.user === false ? null : { id: 'u' }), hasAnyPermission: (c: string[]) => c.some(x => perms.includes(x)) } },
    { provide: TenantEntitlementsService, useValue: { filesFull: full } },
    { provide: DeviceClassService, useValue: { deviceClass: signal(o.phone ? 'phone' : 'desktop') } },
  ] });
  return { svc: TestBed.inject(FilesAccessService), office, full };
}

describe('FilesAccessService', () => {
  it('fails SAFE while loading: nothing writable, apps readable only as the permissions already allow', () => {
    const { svc } = make();
    expect(svc.canWrite(NEURON)).toBe(false);
    expect(svc.canRead(NEURON)).toBe(true);                    // view_report
    expect(svc.canRead(SYNAPSE)).toBe(true);                   // a sign-in is enough
    expect(svc.loaded()).toBe(false);
  });

  it('the beta switch and a sign-in come first: without them there is no Files at all', () => {
    expect(make({ beta: false }).svc.available()).toBe(false);
    TestBed.resetTestingModule();
    const { svc } = make({ user: false });
    expect(svc.available()).toBe(false);
    expect(svc.canRead(SYNAPSE)).toBe(false);
    expect(svc.apps()).toEqual([]);
  });

  it('after the server answers: per-app switches and roles decide; an app switched off disappears from the list', async () => {
    const { svc } = make();
    await svc.ensureLoaded();
    expect(svc.canWrite(NEURON)).toBe(true);
    expect(svc.canRead(AXON)).toBe(false);                      // off for the lab
    expect(svc.canWrite(MYELIN)).toBe(false);                   // role may read, not edit
    expect(svc.canRead(MYELIN)).toBe(true);
    expect(svc.apps().map(a => a.id)).toEqual(['neuron', 'synapse', 'myelin', 'retina']);
    expect(svc.anyApp()).toBe(true);
  });

  it('Neuron still needs the results permissions on top of the lab\'s role list', async () => {
    const { svc } = make({ perms: ['view_patient'] });
    await svc.ensureLoaded();
    expect(svc.canWrite(NEURON)).toBe(false);
    expect(svc.canWrite(SYNAPSE)).toBe(true);
  });

  it('VIEW ONLY (not Full): everything reads, nothing writes, even for a role that may edit; turning Full on restores it', async () => {
    const { svc, full } = make({ full: false });
    await svc.ensureLoaded();
    expect(svc.viewOnly()).toBe(true);
    expect(svc.canRead(NEURON)).toBe(true);
    expect(svc.canWrite(NEURON)).toBe(false);
    expect(svc.canWrite(SYNAPSE)).toBe(false);
    full.set(true);
    expect(svc.canWrite(SYNAPSE)).toBe(true);
  });

  it('phones view and copy only unless the lab allowed editing on phones', async () => {
    const off = make({ phone: true });
    await off.svc.ensureLoaded();
    expect(off.svc.canWrite(SYNAPSE)).toBe(false);
    expect(off.svc.canRead(SYNAPSE)).toBe(true);
    TestBed.resetTestingModule();
    const on = make({ phone: true, acc: access({ editOnPhones: true }) });
    await on.svc.ensureLoaded();
    expect(on.svc.canWrite(SYNAPSE)).toBe(true);
  });

  it('a failed settings call never grants write rights', async () => {
    const { svc } = make({ fail: true });
    await svc.ensureLoaded();
    expect(svc.loaded()).toBe(true);
    expect(svc.canWrite(SYNAPSE)).toBe(false);
  });

  it('loads once, can be refreshed and reset', async () => {
    const { svc, office } = make();
    await svc.ensureLoaded(); await svc.ensureLoaded();
    expect(office.settings).toHaveBeenCalledTimes(1);
    await svc.refresh();
    expect(office.settings).toHaveBeenCalledTimes(2);
    svc.reset();
    expect(svc.loaded()).toBe(false);
    expect(svc.canWrite(SYNAPSE)).toBe(false);
  });
});

describe('Files entitlement (the platform level) is fail-closed', () => {
  it('only a literal true is Full: absent, false, strings and junk are View only', () => {
    expect(filesFullOn({ files: true })).toBe(true);
    for (const w of [null, undefined, {}, { files: false }, { files: 'true' }, { files: 1 }, { inventory: true }]) expect(filesFullOn(w as never)).toBe(false);
  });
});
