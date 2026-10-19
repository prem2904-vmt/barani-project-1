import { qualitativeOptionsFor } from './qualitative';

describe('qualitativeOptionsFor', () => {
  it('detects positive/negative pair in options and returns them verbatim', () => {
    expect(qualitativeOptionsFor({ options: ['Positive', 'Negative'] })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ options: ['positive', 'negative'] })).toEqual(['positive', 'negative']);
    expect(qualitativeOptionsFor({ options: ['POSITIVE', 'NEGATIVE'] })).toEqual(['POSITIVE', 'NEGATIVE']);
  });

  it('detects qualitative pairs with various separators and whitespace', () => {
    expect(qualitativeOptionsFor({ options: ['Positive', 'Negative'] })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ options: ['positive-negative'] })).toBeNull();
    expect(qualitativeOptionsFor({ options: ['Reactive', 'Non-Reactive'] })).toEqual(['Reactive', 'Non-Reactive']);
    expect(qualitativeOptionsFor({ options: ['Reactive', 'Non reactive'] })).toEqual(['Reactive', 'Non reactive']);
    expect(qualitativeOptionsFor({ options: ['Present', 'Absent'] })).toEqual(['Present', 'Absent']);
    expect(qualitativeOptionsFor({ options: ['Detected', 'Not Detected'] })).toEqual(['Detected', 'Not Detected']);
  });

  it('preserves extra options alongside a qualitative pair', () => {
    expect(qualitativeOptionsFor({ options: ['Positive', 'Weakly Positive', 'Negative'] })).toEqual([
      'Positive',
      'Weakly Positive',
      'Negative',
    ]);
    expect(qualitativeOptionsFor({ options: ['Negative', 'Weakly Positive', 'Positive'] })).toEqual([
      'Negative',
      'Weakly Positive',
      'Positive',
    ]);
  });

  it('returns null when options exist but do not contain a qualitative pair', () => {
    expect(qualitativeOptionsFor({ options: ['A', 'B'] })).toBeNull();
    expect(qualitativeOptionsFor({ options: ['Option1', 'Option2'] })).toBeNull();
    expect(qualitativeOptionsFor({ options: ['Normal', 'Abnormal'] })).toBeNull();
  });

  it('filters out empty/whitespace-only option strings before checking for pairs', () => {
    expect(qualitativeOptionsFor({ options: ['Positive', '', 'Negative'] })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ options: ['  ', 'Positive', 'Negative'] })).toEqual(['Positive', 'Negative']);
  });

  it('maps known qualitative type strings to default option pairs', () => {
    expect(qualitativeOptionsFor({ type: 'positive negative' })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ type: 'pos neg' })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ type: 'positive or negative' })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ type: 'qualitative' })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ type: 'reactive non reactive' })).toEqual(['Reactive', 'Non-reactive']);
    expect(qualitativeOptionsFor({ type: 'present absent' })).toEqual(['Present', 'Absent']);
    expect(qualitativeOptionsFor({ type: 'detected not detected' })).toEqual(['Detected', 'Not detected']);
  });

  it('normalizes type strings (trim, lowercase, collapse separators)', () => {
    expect(qualitativeOptionsFor({ type: '  POSITIVE NEGATIVE  ' })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ type: 'Positive_Negative' })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ type: 'positive/negative' })).toEqual(['Positive', 'Negative']);
    expect(qualitativeOptionsFor({ type: 'Positive - Negative' })).toEqual(['Positive', 'Negative']);
  });

  it('returns null when type does not match any known qualitative type', () => {
    expect(qualitativeOptionsFor({ type: 'unknown' })).toBeNull();
    expect(qualitativeOptionsFor({ type: 'text' })).toBeNull();
    expect(qualitativeOptionsFor({ type: 'numeric' })).toBeNull();
  });

  it('handles both type and options, preferring options when they contain a pair', () => {
    expect(qualitativeOptionsFor({ type: 'qualitative', options: ['Positive', 'Negative'] })).toEqual([
      'Positive',
      'Negative',
    ]);
    expect(qualitativeOptionsFor({ type: 'positive negative', options: ['A', 'B'] })).toBeNull();
  });

  it('coerces option values to strings', () => {
    expect(
      qualitativeOptionsFor({ options: [String('Positive'), String('Negative')] as unknown[] as string[] })
    ).toEqual(['Positive', 'Negative']);
  });

  it('returns null for parameter with no options and no type', () => {
    expect(qualitativeOptionsFor({})).toBeNull();
    expect(qualitativeOptionsFor({ type: undefined, options: undefined })).toBeNull();
  });

  it('does not mutate input or return references to type option defaults', () => {
    const result1 = qualitativeOptionsFor({ type: 'qualitative' });
    const result2 = qualitativeOptionsFor({ type: 'qualitative' });
    result1?.push('Modified');
    expect(result2).toEqual(['Positive', 'Negative']);
  });

  it('requires at least two options to check for a qualitative pair', () => {
    expect(qualitativeOptionsFor({ options: ['Positive'] })).toBeNull();
    expect(qualitativeOptionsFor({ options: [] })).toBeNull();
  });

  it('detects pairs regardless of order in the options array', () => {
    expect(qualitativeOptionsFor({ options: ['Negative', 'Positive'] })).toEqual(['Negative', 'Positive']);
    expect(qualitativeOptionsFor({ options: ['Absent', 'Present'] })).toEqual(['Absent', 'Present']);
  });
});
