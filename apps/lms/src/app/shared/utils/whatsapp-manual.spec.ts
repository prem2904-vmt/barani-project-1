import {
  WA_POPUP_NAME, WA_POPUP_WIDTH, WA_REPORT_TEMPLATE, WA_WEB_SEND, isClickToChatUrl, reportPublicLink, waClickToChatUrl,
  waDisplayPhone, waE164, waMeUrl, waPopupFeatures, waPopupRect, waReportMessage,
} from './whatsapp-manual';
import { whatsAppPhone } from './indian-phone';

/** "Send on WhatsApp" (manual): the URL, the phone, the message and the
 *  window placement — and the one link shape it may ever open. */
describe('waE164 — the one phone rule, +91 for a bare 10-digit number', () => {
  it('normalises Indian mobiles to +91XXXXXXXXXX', () => {
    for (const raw of ['9876543210', '09876543210', '919876543210', '+91 98765-43210', '(+91) 98765 43210', '0091 98765 43210']) {
      expect(waE164(raw)).toBe('+919876543210');
    }
  });
  it('invalid / missing → null (nothing opens)', () => {
    for (const raw of [null, undefined, '', '12345', '5876543210', '+1 555 123 4567', '+44 7700 900123', 'abc', '98765 4321x']) {
      expect(waE164(raw)).toBeNull();
    }
  });
  it('agrees with the existing WhatsApp phone helper (single source)', () => {
    for (const raw of ['9876543210', '+91-9000000000', 'nope', '']) {
      expect(waE164(raw)?.slice(1) ?? '').toBe(whatsAppPhone(raw));
    }
  });
  it('shows +91 98765 43210 in the confirm', () => {
    expect(waDisplayPhone('+919876543210')).toBe('+91 98765 43210');
  });
});

describe('waClickToChatUrl — WhatsApp Web click-to-chat only', () => {
  it('builds https://web.whatsapp.com/send?phone=<digits>&text=<encoded>', () => {
    expect(waClickToChatUrl('98765 43210', 'Hi')).toBe('https://web.whatsapp.com/send?phone=919876543210&text=Hi');
    expect(WA_WEB_SEND).toBe('https://web.whatsapp.com/send');
  });
  it('encodes everything in the text (no param can be smuggled in)', () => {
    const text = 'Dear Asha & co, 100% ready? #1 + https://x.y/a?b=c&send=1\nline 2 — ₹';
    const url = waClickToChatUrl('9876543210', text)!;
    const u = new URL(url);
    expect([...u.searchParams.keys()]).toEqual(['phone', 'text']);
    expect(u.searchParams.get('text')).toBe(text);
    expect(u.hash).toBe('');
    expect(isClickToChatUrl(url)).toBe(true);
  });
  it('null for an invalid phone', () => {
    expect(waClickToChatUrl('12345', 'Hi')).toBeNull();
    expect(waClickToChatUrl(null, 'Hi')).toBeNull();
  });
  it('the phone app link carries the same chat (wa.me)', () => {
    expect(waMeUrl('9876543210', 'a b')).toBe('https://wa.me/919876543210?text=a%20b');
    expect(waMeUrl('', 'x')).toBeNull();
  });
});

describe('isClickToChatUrl — the guard', () => {
  it('accepts only the exact link', () => {
    expect(isClickToChatUrl('https://web.whatsapp.com/send?phone=919876543210&text=x')).toBe(true);
    expect(isClickToChatUrl('https://web.whatsapp.com/send?phone=919876543210')).toBe(true);
    for (const bad of [
      'http://web.whatsapp.com/send?phone=919876543210',
      'https://web.whatsapp.com.evil.io/send?phone=919876543210',
      'https://evil.io/send?phone=919876543210',
      'https://web.whatsapp.com/send?phone=919876543210&text=x&send=true',
      'https://web.whatsapp.com/send?phone=919876543210&phone=1',
      'https://web.whatsapp.com/?phone=919876543210',
      'https://web.whatsapp.com/send?phone=abc',
      'https://web.whatsapp.com/send?phone=919876543210#x',
      'javascript:alert(1)', 'nope',
    ]) expect(isClickToChatUrl(bad)).toBe(false);
  });
});

describe('waReportMessage — ONE template', () => {
  it('Dear <name>, your report from <lab> is ready. View it here: <link>', () => {
    expect(WA_REPORT_TEMPLATE).toBe('Dear {patient}, your report from {lab} is ready. View it here: {link}');
    expect(waReportMessage({ patient: 'Asha Rao', lab: 'Micro World', link: 'https://med.prefrontal.health/reports/public/t1' }))
      .toBe('Dear Asha Rao, your report from Micro World is ready. View it here: https://med.prefrontal.health/reports/public/t1');
  });
  it('no name / lab / link: still plain words', () => {
    expect(waReportMessage({})).toBe('Dear patient, your report from our lab is ready.');
  });
  it('extra paragraphs follow (an outside lab report)', () => {
    expect(waReportMessage({ patient: 'A', lab: 'L', link: 'u', extra: [null, ' Partner line ', ''] }))
      .toBe('Dear A, your report from L is ready. View it here: u\n\nPartner line');
  });
  it('the secure link is the identity-checked public report page', () => {
    expect(reportPublicLink('https://med.prefrontal.health/', 'a b')).toBe('https://med.prefrontal.health/reports/public/a%20b');
    expect(reportPublicLink('', 't')).toBe('');
    expect(reportPublicLink('https://x', null)).toBe('');
  });
});

describe('popup placement — phone-shaped at the right edge', () => {
  it('420 wide, full available height, flush right on this screen', () => {
    expect(WA_POPUP_WIDTH).toBe(420);
    expect(WA_POPUP_NAME).toBe('pf-whatsapp');
    expect(waPopupRect({ availWidth: 1440, availHeight: 875, availLeft: 0, availTop: 25 }))
      .toEqual({ width: 420, height: 875, left: 1020, top: 25 });
    // A second monitor to the right.
    expect(waPopupRect({ availWidth: 1920, availHeight: 1050, availLeft: 1440, availTop: 0 }))
      .toEqual({ width: 420, height: 1050, left: 2940, top: 0 });
    expect(waPopupFeatures({ availWidth: 1440, availHeight: 875 }))
      .toBe('popup=yes,width=420,height=875,left=1020,top=0');
  });
  it('a narrow screen keeps it on screen', () => {
    expect(waPopupRect({ availWidth: 360, availHeight: 700 })).toEqual({ width: 360, height: 700, left: 0, top: 0 });
  });
});
