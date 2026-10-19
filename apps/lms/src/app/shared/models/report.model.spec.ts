import { LEGACY_CLASSIC_PRESET, normalizeHeaderPreset } from './report.model';

describe('normalizeHeaderPreset', () => {
  it('pins the pre-rename stored value of the Classic preset', () => {
    expect(LEGACY_CLASSIC_PRESET).toBe('drlogy'); // the shim's pin
  });

  it('reads the pre-rename value as classic', () => {
    expect(normalizeHeaderPreset(LEGACY_CLASSIC_PRESET)).toBe('classic');
  });

  it('keeps every current preset as-is', () => {
    for (const p of ['classic', 'centered', 'banner', 'minimal'] as const) expect(normalizeHeaderPreset(p)).toBe(p);
  });

  it('defaults missing or unknown values to classic', () => {
    expect(normalizeHeaderPreset(undefined)).toBe('classic');
    expect(normalizeHeaderPreset(null)).toBe('classic');
    expect(normalizeHeaderPreset('')).toBe('classic');
    expect(normalizeHeaderPreset('fancy')).toBe('classic');
  });
});
