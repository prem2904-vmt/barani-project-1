import { canonicalNotificationType } from './notification-type';

describe('canonicalNotificationType', () => {
  it('strips the legacy lms. prefix', () => {
    expect(canonicalNotificationType('lms.report_ready')).toBe('report_ready');
    expect(canonicalNotificationType('LMS.tat_breach')).toBe('tat_breach');
    expect(canonicalNotificationType('  lms.sample_rejection ')).toBe('sample_rejection');
  });

  it('keeps canonical keys and never throws on empty input', () => {
    expect(canonicalNotificationType('critical_value')).toBe('critical_value');
    expect(canonicalNotificationType('chat-message')).toBe('chat-message');
    expect(canonicalNotificationType('')).toBe('');
    expect(canonicalNotificationType(null)).toBe('');
    expect(canonicalNotificationType(undefined)).toBe('');
  });
});
