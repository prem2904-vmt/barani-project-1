import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Invoice preview on a phone (found by the phone form-factor screens run, 2026-11-13): the header's
 * Download · WhatsApp · Print · Close did not fit one row at 390px — Close was pushed off-screen and Download
 * covered the "Invoice" label. In the ≤640px pass the header and its actions wrap.
 */
const mobile = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/features/frontdesk/frontdesk-landing/styles/_mobile.scss'), 'utf8');
const phoneBlock = mobile.slice(mobile.indexOf('@media (max-width: 640px)'));
const rule = (sel: string) => {
  const m = new RegExp(`\\n\\s*${sel.replace(/[.$]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(phoneBlock);
  return m ? m[1] : '';
};

describe('invoice preview header on a phone', () => {
  it('the header wraps', () => {
    expect(rule('.pf-inv-preview__hdr')).toMatch(/flex-wrap:\s*wrap/);
  });
  it('the actions take their own full-width row and wrap inside it', () => {
    const a = rule('.pf-inv-preview__actions');
    expect(a).toMatch(/flex-wrap:\s*wrap/);
    expect(a).toMatch(/flex:\s*1 1 100%/);
  });
  it('only in the phone pass (the desktop / tablet header is unchanged)', () => {
    const base = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/features/frontdesk/frontdesk-landing/styles/_drawers-modals.scss'), 'utf8');
    expect(base).toMatch(/\.pf-inv-preview__actions \{ display: flex; align-items: center; gap: 8px; \}/);
  });
});
