import { isSignedOrSkipped, lineStatusLabel, NOT_REPORTED } from './line-status';

describe('line-status', () => {
  it('labels not_reported as "Not reported" — never raw text', () => {
    expect(lineStatusLabel(NOT_REPORTED)).toBe('Not reported');
    expect(lineStatusLabel('in_progress')).toBe('In progress');
    expect(lineStatusLabel('re_entry')).toBe('Re-entry');
    expect(lineStatusLabel('some_new_state')).toBe('Some new state');
    expect(lineStatusLabel(null)).toBe('—');
  });
  it('validated and not reported are both done', () => {
    expect(isSignedOrSkipped('validated')).toBe(true);
    expect(isSignedOrSkipped(NOT_REPORTED)).toBe(true);
    expect(isSignedOrSkipped('entered')).toBe(false);
  });
});
