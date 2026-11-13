import { emailOutcomeToasts, emailSkipReason } from './email-share';

describe('Email share — toasts tell the server\'s truth', () => {
  it('sent to the patient (and the doctor) names the addresses the server returned', () => {
    expect(emailOutcomeToasts({ sent: [{ kind: 'patient', address: 'a••@x.in' }], skipped: [] }, 'patient'))
      .toEqual([{ tone: 'success', text: 'Report emailed to a••@x.in' }]);
    expect(emailOutcomeToasts({ sent: [{ kind: 'patient', address: 'a@x.in' }, { kind: 'doctor', address: 'd@y.in' }], skipped: [] }, 'both'))
      .toEqual([{ tone: 'success', text: 'Report emailed to a@x.in and the referral doctor (d@y.in)' }]);
    expect(emailOutcomeToasts({ sent: [{ kind: 'doctor', address: 'd@y.in' }], skipped: [] }, 'doctor'))
      .toEqual([{ tone: 'success', text: 'Report emailed to the referral doctor (d@y.in)' }]);
  });

  it('a skip is said in plain words; nothing sent = an error, never success', () => {
    expect(emailOutcomeToasts({ sent: [], skipped: [{ kind: 'patient', reason: 'no_email' }] }, 'patient'))
      .toEqual([{ tone: 'error', text: 'Not emailed to the patient: no email address on file' }]);
    expect(emailOutcomeToasts({ sent: [{ kind: 'doctor', address: 'd@y.in' }], skipped: [{ kind: 'patient', reason: 'opted_out' }] }, 'both'))
      .toEqual([
        { tone: 'success', text: 'Report emailed to the referral doctor (d@y.in)' },
        { tone: 'warning', text: 'Not emailed to the patient: they asked not to get messages' },
      ]);
    expect(emailOutcomeToasts({ sent: [], skipped: [] }, 'patient')).toEqual([{ tone: 'error', text: 'The report was not emailed' }]);
    expect(emailOutcomeToasts(null, 'patient', 'invoice')).toEqual([{ tone: 'error', text: 'The invoice was not emailed' }]);
  });

  it('"both" with a doctor who has no email stays quiet when the patient got it; asked for the doctor alone it is said', () => {
    const res = { sent: [{ kind: 'patient' as const, address: 'a@x.in' }], skipped: [{ kind: 'doctor' as const, reason: 'no_email' }] };
    expect(emailOutcomeToasts(res, 'both')).toEqual([{ tone: 'success', text: 'Report emailed to a@x.in' }]);
    expect(emailOutcomeToasts({ sent: [], skipped: [{ kind: 'doctor', reason: 'no_email' }] }, 'doctor'))
      .toEqual([{ tone: 'error', text: 'Not emailed to the referral doctor: no email address on file' }]);
  });

  it('invoice wording', () => {
    expect(emailOutcomeToasts({ sent: [{ kind: 'patient', address: 'a@x.in' }], skipped: [] }, 'patient', 'invoice'))
      .toEqual([{ tone: 'success', text: 'Invoice emailed to a@x.in' }]);
  });

  it('reason words: codes mapped, server sentences passed through', () => {
    expect(emailSkipReason('invalid_email')).toBe('the email address on file is not valid');
    expect(emailSkipReason('some_new_code')).toBe('some new code');
    expect(emailSkipReason('The mailbox is full.')).toBe('The mailbox is full.');
    expect(emailSkipReason(null)).toBe('it could not be sent');
  });
});
