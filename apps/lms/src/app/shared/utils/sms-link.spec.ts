import { readSmsEnv, smsDoctorReportMessage, smsPlatform, smsReportMessage, smsUri } from './sms-link';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

describe('SMS Chat link (sms:)', () => {
  it('knows the platform: native first, then the user agent (iPad-as-Mac = iOS)', () => {
    expect(smsPlatform({ nativePlatform: 'ios', userAgent: ANDROID })).toBe('ios');
    expect(smsPlatform({ nativePlatform: 'android', userAgent: IPHONE })).toBe('android');
    expect(smsPlatform({ userAgent: IPHONE })).toBe('ios');
    expect(smsPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe('ios');
    expect(smsPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe('other');   // a real Mac
    expect(smsPlatform({ userAgent: ANDROID })).toBe('android');
  });

  it('iOS uses sms:NUMBER&body=, Android (and others) sms:NUMBER?body=; the body is URL-encoded', () => {
    const body = 'Dear Asha, your report from Demo Lab is ready. View it here: https://r.example/x?a=1&b=2';
    expect(smsUri('9876543210', body, 'ios')).toBe(`sms:+919876543210&body=${encodeURIComponent(body)}`);
    expect(smsUri('+91 98765 43210', body, 'android')).toBe(`sms:+919876543210?body=${encodeURIComponent(body)}`);
    expect(smsUri('098765 43210', 'x', 'other')).toBe('sms:+919876543210?body=x');
    expect(decodeURIComponent(smsUri('9876543210', body, 'android')!.split('?body=')[1])).toBe(body);
  });

  it('no link for an invalid / missing number', () => {
    for (const n of [null, undefined, '', '12345', 'abc']) expect(smsUri(n, 'x', 'ios')).toBeNull();
  });

  it('messages: one short report-ready line + the report link', () => {
    expect(smsReportMessage({ patient: 'Asha Rao', lab: 'Demo Lab', link: 'https://r/p/tok' }))
      .toBe('Dear Asha Rao, your report from Demo Lab is ready. View it here: https://r/p/tok');
    expect(smsReportMessage({ lab: 'Demo Lab' })).toBe('Your report from Demo Lab is ready.');
    expect(smsDoctorReportMessage({ doctor: 'Dr. Ravi', patient: 'Asha Rao', lab: 'Demo Lab', link: 'https://r/p/tok' }))
      .toBe('Dear Dr. Ravi, the report of Asha Rao from Demo Lab is ready. View it here: https://r/p/tok');
  });

  it('reads the env from a window (Capacitor platform only when native)', () => {
    const w = { navigator: { userAgent: ANDROID, maxTouchPoints: 5 }, Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
    expect(readSmsEnv(w as never)).toEqual({ nativePlatform: 'android', userAgent: ANDROID, maxTouchPoints: 5 });
    const web = { navigator: { userAgent: IPHONE, maxTouchPoints: 5 }, Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } };
    expect(readSmsEnv(web as never).nativePlatform).toBeNull();
  });
});
