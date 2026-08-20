import { TatColorPipe } from './tat-color.pipe';

describe('TatColorPipe', () => {
  it('returns red styles for urgent level', () => {
    expect(new TatColorPipe().transform('urgent')).toBe('bg-red-50 text-red-700 border-red-200');
  });

  it('returns orange styles for high level', () => {
    expect(new TatColorPipe().transform('high')).toBe('bg-orange-50 text-orange-700 border-orange-200');
  });

  it('returns emerald styles for normal level', () => {
    expect(new TatColorPipe().transform('normal')).toBe('bg-emerald-50 text-emerald-700 border-emerald-200');
  });

  it('returns slate styles for unknown string level', () => {
    expect(new TatColorPipe().transform('unknown')).toBe('bg-slate-50 text-slate-700 border-slate-200');
  });

  it('returns slate styles for arbitrary string', () => {
    expect(new TatColorPipe().transform('low')).toBe('bg-slate-50 text-slate-700 border-slate-200');
  });

  it('returns slate styles for null', () => {
    expect(new TatColorPipe().transform(null)).toBe('bg-slate-50 text-slate-700 border-slate-200');
  });

  it('returns slate styles for undefined', () => {
    expect(new TatColorPipe().transform(undefined)).toBe('bg-slate-50 text-slate-700 border-slate-200');
  });

  it('returns slate styles for empty string', () => {
    expect(new TatColorPipe().transform('')).toBe('bg-slate-50 text-slate-700 border-slate-200');
  });

  it('is case-sensitive (lowercase only)', () => {
    expect(new TatColorPipe().transform('URGENT')).toBe('bg-slate-50 text-slate-700 border-slate-200');
    expect(new TatColorPipe().transform('Urgent')).toBe('bg-slate-50 text-slate-700 border-slate-200');
    expect(new TatColorPipe().transform('HIGH')).toBe('bg-slate-50 text-slate-700 border-slate-200');
  });
});
