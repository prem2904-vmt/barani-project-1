import { fitPlaceholder, placeholderCandidates } from './placeholder-fit';

/** Owner 2026-11-21: band search placeholders must fit a 390px phone ("Search pa…" was clipped). */
describe('placeholder fit', () => {
  const px = (s: string) => s.length * 8;   // 8px per character

  it('offers shorter forms: before the separator, two words, the first word', () => {
    expect(placeholderCandidates('Search patient · name, phone, MRN, ABHA…')).toEqual(['Search patient · name, phone, MRN, ABHA…', 'Search patient', 'Search']);
    expect(placeholderCandidates('Search doctors — name, hospital, department, phone…')).toEqual(['Search doctors — name, hospital, department, phone…', 'Search doctors', 'Search']);
    expect(placeholderCandidates('Search WhatsApp, email and SMS accounts')).toEqual(['Search WhatsApp, email and SMS accounts', 'Search WhatsApp', 'Search']);
    expect(placeholderCandidates('Search Collection and queues')).toEqual(['Search Collection and queues', 'Search Collection', 'Search']);
    expect(placeholderCandidates('Search')).toEqual(['Search']);
  });

  it('keeps the full sentence when it fits, else the longest shorter form that does', () => {
    const full = 'Search patient · name, phone, MRN, ABHA…';
    expect(fitPlaceholder(full, 1000, px)).toBe(full);
    expect(fitPlaceholder(full, 130, px)).toBe('Search patient');
    expect(fitPlaceholder(full, 60, px)).toBe('Search');
    expect(fitPlaceholder(full, 10, px)).toBe('');      // nothing fits: no placeholder, never a clipped one
    expect(fitPlaceholder(full, 0, px)).toBe(full);   // not laid out yet: leave it
  });
});
