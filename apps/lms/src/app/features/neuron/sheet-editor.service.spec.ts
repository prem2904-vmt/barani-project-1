import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { SheetEditorService } from './sheet-editor.service';
import { FilesAccessService } from '../files/files-access.service';

function make(o: { allowed?: string[]; historyLen?: number } = {}) {
  const router = { url: '/insights?section=tests&period=month', navigateByUrl: vi.fn(async () => true) };
  const location = { back: vi.fn() };
  const allowed = o.allowed ?? ['neuron', 'synapse', 'axon', 'myelin', 'retina'];
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router }, { provide: Location, useValue: location },
      { provide: FilesAccessService, useValue: { ensureLoaded: async () => undefined, canRead: (a: string) => allowed.includes(a) } },
    ],
  });
  return { svc: TestBed.inject(SheetEditorService), router, location };
}

describe('SheetEditorService: the one way into the Files editors', () => {
  it('is unavailable (and open does nothing) when the app is off for the lab / the role cannot open it', async () => {
    const off = make({ allowed: [] });
    expect(off.svc.available()).toBe(false);
    expect(await off.svc.open({ source: 'Insights' })).toBe(false);
    expect(off.router.navigateByUrl).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const onlyDocs = make({ allowed: ['synapse'] });
    expect(onlyDocs.svc.available()).toBe(false);                      // Neuron (the default) is off
    expect(onlyDocs.svc.available('synapse')).toBe(true);
    expect(await onlyDocs.svc.open({ source: 'Reports', app: 'axon' })).toBe(false);
  });

  it('open() remembers the screen it came from, goes to the app\'s editor route, and hands the request over once', async () => {
    const { svc, router } = make();
    await svc.open({ source: 'Insights', insert: { from: '2026-11-01', to: '2026-11-07' } });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/files/sheet/new');
    expect(svc.openedFromScreen).toBe(true);
    expect(svc.take()?.source).toBe('Insights');
    expect(svc.take()).toBeNull();
  });

  it('every app has its own editor route; a stored file goes by id', async () => {
    const { svc, router } = make();
    await svc.open({ source: 'Files', app: 'synapse' });
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/files/doc/new');
    await svc.open({ source: 'Files', app: 'axon' });
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/files/slides/new');
    await svc.open({ source: 'Files', app: 'myelin', fileId: 'abc' });
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/files/pdf/abc');
    await svc.open({ source: 'Files', app: 'retina' });
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/files/image/new');
  });

  it('navUrl: while an editor is open the nav sees the screen it came from; elsewhere the URL as it is', async () => {
    const { svc } = make();
    expect(svc.navUrl('/files/sheet/new')).toBe('/files/sheet/new');
    await svc.open({ source: 'Insights' });
    expect(svc.navUrl('/files/sheet/new')).toBe('/insights');
    expect(svc.navUrl('/files/doc/abc')).toBe('/insights');
    expect(svc.navUrl('/files')).toBe('/files');                         // Files home itself is a normal screen
    expect(svc.navUrl('/frontdesk')).toBe('/frontdesk');
    expect(svc.originUrl).toBe('/insights?section=tests&period=month');
  });

  it('back() returns through the router history (the screen keeps its URL and filters)', async () => {
    const { svc, location } = make();
    Object.defineProperty(history, 'length', { value: 3, configurable: true });
    await svc.open({ source: 'Insights' });
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
    expect(svc.openedFromScreen).toBe(false);
  });

  it('with no history it navigates to the remembered URL instead, or to Files when there is none', async () => {
    const { svc, router, location } = make();
    Object.defineProperty(history, 'length', { value: 1, configurable: true });
    await svc.open({ source: 'Insights' });
    svc.back();
    expect(location.back).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/insights?section=tests&period=month');
    svc.back();
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/files');
  });
});
