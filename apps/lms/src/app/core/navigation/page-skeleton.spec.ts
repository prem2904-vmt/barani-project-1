import { pagePath, pageSkeletonFor } from './page-skeleton';

/**
 * The destination frame's layout per screen (page-skeleton.ts). Every audited
 * main screen opens with a frame in ITS layout — never a blank page.
 */
describe('pageSkeletonFor (the destination frame per screen)', () => {
  const kind = (u: string) => pageSkeletonFor(u)?.kind ?? null;

  it('the audited main screens each get their own layout', () => {
    const expected: Record<string, string> = {
      '/frontdesk': 'dashboard',
      '/frontdesk/order': 'form',
      '/frontdesk/order?patientId=p1&draft=d1': 'form',
      '/lab/collect': 'queue',
      '/sample-collection': 'queue',
      '/lab/receive': 'queue',
      '/lab/my-work': 'queue',
      '/lab/sample/S-123': 'detail',
      '/lab/result/ot-1': 'detail',
      '/lab/culture/ot-9': 'detail',
      '/pathologist': 'queue',
      '/pathologist/validate/o1': 'detail',
      '/reports': 'grid',
      '/reports/view/r1': 'detail',
      '/frontdesk/patients/p1': 'detail',
      '/frontdesk/patients/new': 'form',
      '/admin/tests': 'grid-side',
      '/admin/tests/CBC/edit': 'form',
      '/admin/tests/new': 'form',
      '/admin/lab-settings': 'form',
      '/lab/settings': 'tiles',
      '/admin/users': 'grid',
      '/admin/users/u1/edit': 'form',
      '/billing-counter': 'grid',
      '/messages': 'chat',
      '/dashboard': 'dashboard',
      '/w/lab-menu': 'tiles',
      '/admin': 'tiles',
      '/admin/manage': 'tiles',
    };
    for (const [url, k] of Object.entries(expected)) expect(kind(url), url).toBe(k);
  });

  it('names the screen for the screen-reader status', () => {
    expect(pageSkeletonFor('/admin/tests')?.label).toBe('Opening Test Master…');
    expect(pageSkeletonFor('/lab/my-work')?.label).toBe('Opening My Work…');
  });

  it('an unlisted in-app screen still opens with the generic work frame', () => {
    expect(pageSkeletonFor('/some/new/screen')).toEqual({ kind: 'queue', label: 'Opening page…' });
  });

  it('no frame for the branch hop, the landing redirect, sign-in and public pages', () => {
    for (const u of ['/_branch', '/', '', '/login', '/403', '/track/tok', '/reports/public/tok', '/set-password']) {
      expect(pageSkeletonFor(u), u).toBeNull();
    }
  });

  it('pagePath drops query, hash and trailing slash', () => {
    expect(pagePath('/admin/tests/?q=cbc#x')).toBe('/admin/tests');
    expect(pagePath(null)).toBe('/');
  });
});
