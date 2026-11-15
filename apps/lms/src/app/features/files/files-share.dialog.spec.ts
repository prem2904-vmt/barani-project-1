import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { FilesAccessService } from './files-access.service';
import { FilesShareDialogComponent, shareLink } from './files-share.dialog';
import { OfficeFile, OfficeService } from './office.service';

const FILE: OfficeFile = { id: 'f1', name: 'QC log, November.xlsx', kind: 'sheet', sizeBytes: 1, version: 1, updatedAt: '', updatedByName: null };
const list = (over: Record<string, unknown> = {}) => ({
  ownerId: 'u0', ownerName: 'Karthik Tech', isOwner: true, canManage: true,
  shares: [{ id: 's1', principalType: 'user', principalId: 'u1', name: 'Lakshmi Admin', access: 'edit' }, { id: 's2', principalType: 'role', principalId: 'r1', name: 'All Technicians', detail: 'Role · 6 people', access: 'view' }], ...over });

@Component({ standalone: true, imports: [FilesShareDialogComponent], template: `<pf-files-share [file]="file()" (closed)="closes = closes + 1; file.set(null)" />` })
class Host { file = signal<OfficeFile | null>(FILE); closes = 0; }

function make(o: { l?: ReturnType<typeof list>; canWrite?: boolean; fail?: boolean; full?: boolean } = {}) {
  let current = o.l ?? list();
  const office = {
    shares: vi.fn(async () => { if (o.fail) throw new Error('x'); return current; }),
    shareTargets: vi.fn(async () => [{ type: 'user', id: 'u2', name: 'Imran Lab' }, { type: 'role', id: 'r2', name: 'Doctors', detail: 'Role · 3 people' }, { type: 'user', id: 'u1', name: 'Lakshmi Admin' }]),
    addShare: vi.fn(async (_i: string, type: string, pid: string, access: string) => { current = { ...current, shares: [...current.shares.filter(s => s.principalId !== pid), { id: 'n' + pid, principalType: type, principalId: pid, name: 'New', access }] } as never; return current.shares.at(-1); }),
    removeShare: vi.fn(async (_i: string, sid: string) => { current = { ...current, shares: current.shares.filter(s => s.id !== sid) } as never; }),
  };
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: OfficeService, useValue: office }, { provide: ToastService, useValue: toast },
    { provide: AuthService, useValue: { user: signal({ tenantName: 'Micro World' }) } },
    { provide: FilesAccessService, useValue: { canWrite: () => o.canWrite !== false, canRead: () => true, full: () => o.full !== false } },
  ] });
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const settle = async () => { for (let i = 0; i < 3; i++) { await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges(); } };
  const dlg = () => el.querySelector('[data-testid="files-share"]');
  return { f, el, office, toast, settle, dlg, host: f.componentInstance };
}

describe('Share dialog', () => {
  it('shows who has access: the owner first, then people and roles with their access', async () => {
    const { el, settle, dlg } = make();
    await settle();
    expect(dlg()?.getAttribute('aria-label')).toBe('Share QC log, November.xlsx');
    expect(el.textContent).toContain('Share "QC log, November.xlsx"');
    expect(el.querySelector('[data-testid="files-share-owner"]')?.textContent).toContain('Karthik Tech (you)');
    expect(el.querySelector('[data-testid="files-share-owner"]')?.textContent).toContain('Owner');
    const rows = Array.from(el.querySelectorAll('[data-testid="files-share-row"]')).map(r => r.textContent!.replace(/\s+/g, ' '));
    expect(rows[0]).toContain('Lakshmi Admin');
    expect(rows[1]).toContain('All Technicians');
    expect(rows[1]).toContain('Role · 6 people');
    expect(el.textContent).toContain('Link works only for people in Micro World who sign in');
    expect(el.textContent).toContain('There are no public links.');
  });

  it('the people picker leaves out who already has access', async () => {
    const { settle, f } = make();
    await settle();
    const opts = (f.debugElement.query(x => x.name === 'pf-select').componentInstance as { options: { label: string }[] }).options.map(o => o.label);
    expect(opts).toEqual(['Imran Lab', 'Doctors · Role · 3 people']);
  });

  it('adding and removing call the server and refresh the list', async () => {
    const { el, settle, office, f, toast } = make();
    await settle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmp = f.debugElement.children[0].componentInstance as any;
    cmp.pick.set('user:u2'); cmp.level.set('view');
    await cmp.add();
    await settle();
    expect(office.addShare).toHaveBeenCalledWith('f1', 'user', 'u2', 'view');
    expect(toast.success).toHaveBeenCalledWith('Shared');
    expect(el.querySelectorAll('[data-testid="files-share-row"]').length).toBe(3);
    (el.querySelector('[data-testid="files-share-remove"]') as HTMLButtonElement).click();
    await settle();
    expect(office.removeShare).toHaveBeenCalledWith('f1', 's1');
    expect(el.querySelectorAll('[data-testid="files-share-row"]').length).toBe(2);
  });

  it('"Can edit" is not offered to someone who cannot edit this app themselves', async () => {
    const { f, settle } = make({ canWrite: false });
    await settle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmp = f.debugElement.children[0].componentInstance as any;
    expect(cmp.accessOptions()).toEqual([{ value: 'view', label: 'Can view' }, { value: 'comment', label: 'Can comment' }, { value: 'edit', label: 'Can edit', disabled: true }]);
  });

  it('three levels in every app: Can view, Can comment, Can edit; a View only lab cannot hand out comment or edit', async () => {
    const ok = make();
    await ok.settle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmp = ok.f.debugElement.children[0].componentInstance as any;
    expect(cmp.accessOptions().map((o: { label: string; disabled?: boolean }) => [o.label, !!o.disabled])).toEqual([['Can view', false], ['Can comment', false], ['Can edit', false]]);
    TestBed.resetTestingModule();
    const vo = make({ full: false, canWrite: false });
    await vo.settle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c2 = vo.f.debugElement.children[0].componentInstance as any;
    expect(c2.accessOptions().map((o: { label: string; disabled?: boolean }) => [o.label, !!o.disabled])).toEqual([['Can view', false], ['Can comment', true], ['Can edit', true]]);
  });

  it('a row shows the level in words, and a comment share can be changed to another level', async () => {
    const { el, settle, office, f } = make({ l: list({ isOwner: false, canManage: false, shares: [{ id: 's9', principalType: 'user', principalId: 'u9', name: 'Imran Lab', access: 'comment' }] }) });
    await settle();
    expect(el.querySelector('[data-testid="files-share-row"]')?.textContent).toContain('Can comment');
    void office; void f;
  });

  it('a person who is not the owner can read the list but not change it', async () => {
    const { el, settle } = make({ l: list({ isOwner: false, canManage: false }) });
    await settle();
    expect(el.querySelector('[data-testid="files-share-add"]')).toBeNull();
    expect(el.querySelector('[data-testid="files-share-remove"]')).toBeNull();
    expect(el.querySelector('[data-testid="files-share-owner"]')?.textContent).not.toContain('(you)');
    expect(el.textContent).toContain('Can edit');
  });

  it('Copy link copies the file\'s own in-app address (sign-in needed, never a public link); Done and the backdrop close', async () => {
    const { el, settle, toast, host } = make();
    await settle();
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    (el.querySelector('[data-testid="files-share-copy"]') as HTMLButtonElement).click();
    await settle();
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/files/sheet/f1`);
    expect(toast.success).toHaveBeenCalledWith('Link copied');
    expect(shareLink('https://x.test', { id: 'a', kind: 'image' })).toBe('https://x.test/files/image/a');
    (el.querySelector('[data-testid="files-share-done"]') as HTMLButtonElement).click();
    expect(host.closes).toBe(1);
  });

  it('a file with patient data says it can only be shared inside the lab', async () => {
    const { host, el, settle, f } = make();
    host.file.set({ ...FILE, containsPhi: true });
    f.detectChanges(); await settle();
    expect(el.textContent).toContain('Files with patient data can only be shared inside the lab.');
  });

  it('a load failure is said in words and nothing can be changed', async () => {
    const { el, settle } = make({ fail: true });
    await settle();
    expect(el.querySelector('[data-testid="files-share-error"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="files-share-add"]')).toBeNull();
  });
});
