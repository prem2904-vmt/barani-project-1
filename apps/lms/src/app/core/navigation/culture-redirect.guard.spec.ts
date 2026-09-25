import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiService } from '../services/api.service';
import { AuthService } from '../auth/auth.service';
import {
  cultureOnlyTest, cultureResultRedirectGuard, cultureSampleRedirectGuard, isCultureOrderTest,
} from './culture-redirect.guard';
import { appRoutes as routes } from '../../app.routes';

const C = JSON.stringify({ microFormat: 'culture_sensitivity', parameters: [] });
const N = JSON.stringify({ parameters: [{ name: 'hb' }] });
const t = (id: string, params: string) => ({ id, test: { parameters: params } }) as any;

function setup(get: (url: string) => any, perms = ['culture_workbench']) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: { get } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
    ],
  });
}
const snap = (params: Record<string, string>, query: Record<string, string> = {}) =>
  ({ paramMap: convertToParamMap(params), queryParamMap: convertToParamMap(query) }) as ActivatedRouteSnapshot;
const run = (g: any, s: ActivatedRouteSnapshot) => TestBed.runInInjectionContext(() => g(s, {} as any)) as Promise<boolean | UrlTree>;
const url = (r: boolean | UrlTree) => (r instanceof UrlTree ? TestBed.inject(Router).serializeUrl(r) : r);

describe('culture marker helpers', () => {
  it('isCultureOrderTest follows the Culture panel marker (microFormat culture_sensitivity)', () => {
    expect(isCultureOrderTest(t('a', C))).toBe(true);
    expect(isCultureOrderTest(t('b', N))).toBe(false);
    expect(isCultureOrderTest(t('c', '{bad'))).toBe(false);
    expect(isCultureOrderTest({} as any)).toBe(false);
  });
  it('cultureOnlyTest: a culture-only tube → its culture test; mixed / plain → null', () => {
    expect(cultureOnlyTest({ tests: [t('ot-1', C)] })?.id).toBe('ot-1');
    expect(cultureOnlyTest({ tests: [t('ot-1', C), t('ot-2', N)] })).toBeNull();
    expect(cultureOnlyTest({ tests: [t('ot-2', N)] })).toBeNull();
    expect(cultureOnlyTest({ tests: [] })).toBeNull();
  });
});

describe('search / scan / deep link → /lab/sample/:id', () => {
  it('a culture sample goes to the Culture case page', async () => {
    setup(() => of({ tests: [t('ot-9', C)] }));
    expect(url(await run(cultureSampleRedirectGuard, snap({ sampleId: 's-1' })))).toBe('/lab/culture/ot-9');
  });
  it('a non-culture sample stays on result entry', async () => {
    setup(() => of({ tests: [t('ot-2', N)] }));
    expect(await run(cultureSampleRedirectGuard, snap({ sampleId: 's-2' }))).toBe(true);
  });
  it('pathologist review (?validate=1) stays on the sample screen', async () => {
    const get = vi.fn(() => of({ tests: [t('ot-9', C)] }));
    setup(get);
    expect(await run(cultureSampleRedirectGuard, snap({ sampleId: 's-1' }, { validate: '1' }))).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
  it('no culture-bench permission → no redirect (the bench would refuse)', async () => {
    setup(() => of({ tests: [t('ot-9', C)] }), []);
    expect(await run(cultureSampleRedirectGuard, snap({ sampleId: 's-1' }))).toBe(true);
  });
  it('an API error lets the page load and show its own error', async () => {
    setup(() => throwError(() => new Error('404')));
    expect(await run(cultureSampleRedirectGuard, snap({ sampleId: 's-x' }))).toBe(true);
  });
});

describe('old per-test URL /lab/result/:id', () => {
  it('redirects a culture test to /lab/culture/:id (bookmarks keep working)', async () => {
    setup(() => of(t('ot-5', C)));
    expect(url(await run(cultureResultRedirectGuard, snap({ id: 'ot-5' })))).toBe('/lab/culture/ot-5');
  });
  it('leaves a non-culture test on result entry', async () => {
    setup(() => of(t('ot-6', N)));
    expect(await run(cultureResultRedirectGuard, snap({ id: 'ot-6' }))).toBe(true);
  });
});

describe('routes carry the guards', () => {
  const flat = (rs: any[]): any[] => rs.flatMap(r => [r, ...flat(r.children ?? [])]);
  it('/lab/sample/:sampleId and /lab/result/:id both run the culture redirect', () => {
    const all = flat(routes as any[]);
    expect(all.find(r => r.path === 'lab/sample/:sampleId')?.canActivate).toContain(cultureSampleRedirectGuard);
    expect(all.find(r => r.path === 'lab/result/:id')?.canActivate).toContain(cultureResultRedirectGuard);
  });
});
