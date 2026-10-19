import { isSignedOut403 } from './auth.interceptor';

/**
 * A 403 is ambiguous: it can mean "you are signed out" or "you are not
 * allowed". Sending the second case to the login screen would sign people
 * out for opening a page they simply lack permission for, so the split is
 * worth pinning down.
 */
describe('isSignedOut403', () => {
  const live = { skip: false, authed: true, hasToken: true };
  const gone = { skip: false, authed: false, hasToken: false };

  it('bounces a 403 when there is no session left — the stranded-after-sign-out case', () => {
    expect(isSignedOut403(403, gone)).toBe(true);
  });

  it('does NOT bounce a 403 from a live session — reception hitting an admin-only endpoint', () => {
    expect(isSignedOut403(403, live)).toBe(false);
  });

  it('bounces a half-dead session — a profile without a token, or a token without a profile', () => {
    // Both halves are required to call a session usable. Either one missing
    // means the request could never have been authorised, so it is the
    // signed-out case, not a permission verdict.
    expect(isSignedOut403(403, { skip: false, authed: true, hasToken: false })).toBe(true);
    expect(isSignedOut403(403, { skip: false, authed: false, hasToken: true })).toBe(true);
  });

  it('never bounces on auth endpoints — a 403 there is the verdict, not a dead session', () => {
    expect(isSignedOut403(403, { ...gone, skip: true })).toBe(false);
    expect(isSignedOut403(403, { ...live, skip: true })).toBe(false);
  });

  it('ignores every other status — 401 has its own refresh-then-retry path', () => {
    for (const status of [200, 400, 401, 404, 409, 422, 500, 503]) {
      expect(isSignedOut403(status, gone)).toBe(false);
      expect(isSignedOut403(status, live)).toBe(false);
    }
  });
});
