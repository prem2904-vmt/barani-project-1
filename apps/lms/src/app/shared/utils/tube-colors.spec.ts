import { tubeColor, tubeHex, TUBE_COLORS, TubeColor } from './tube-colors';

describe('tubeColor', () => {
  it('resolves canonical keys to their TubeColor objects', () => {
    const sst = tubeColor('sst');
    expect(sst).toEqual({ key: 'sst', label: 'SST · Gold', short: 'Gold', hex: '#eab308' });

    const plain = tubeColor('plain');
    expect(plain).toEqual({ key: 'plain', label: 'Plain · Red', short: 'Red', hex: '#ef4444' });
  });

  it('resolves all canonical keys from the TUBE_COLORS array', () => {
    TUBE_COLORS.forEach((expected) => {
      expect(tubeColor(expected.key)).toEqual(expected);
    });
  });

  it('handles case insensitivity', () => {
    expect(tubeColor('SST')).toEqual(tubeColor('sst'));
    expect(tubeColor('EDTA')).toEqual(tubeColor('edta'));
    expect(tubeColor('HePaRiN')).toEqual(tubeColor('heparin'));
  });

  it('trims whitespace before lookup', () => {
    expect(tubeColor('  sst  ')).toEqual(tubeColor('sst'));
    expect(tubeColor('\tcitrate\n')).toEqual(tubeColor('citrate'));
  });

  it('returns undefined for null, undefined, or empty string', () => {
    expect(tubeColor(null)).toBeUndefined();
    expect(tubeColor(undefined)).toBeUndefined();
    expect(tubeColor('')).toBeUndefined();
    expect(tubeColor('   ')).toBeUndefined();
  });

  it('maps legacy color keys onto canonical ones', () => {
    expect(tubeColor('red')).toEqual(tubeColor('plain'));
    expect(tubeColor('lavender')).toEqual(tubeColor('edta'));
    expect(tubeColor('grey')).toEqual(tubeColor('fluoride'));
    expect(tubeColor('blue')).toEqual(tubeColor('citrate'));
    expect(tubeColor('gold')).toEqual(tubeColor('sst'));
    expect(tubeColor('yellow')).toEqual(tubeColor('urine'));
    expect(tubeColor('green')).toEqual(tubeColor('heparin'));
    expect(tubeColor('black')).toEqual(tubeColor('esr'));
  });

  it('handles legacy keys with case insensitivity', () => {
    expect(tubeColor('RED')).toEqual(tubeColor('plain'));
    expect(tubeColor('LAVENDER')).toEqual(tubeColor('edta'));
    expect(tubeColor('Gold')).toEqual(tubeColor('sst'));
  });

  it('returns undefined for unknown keys', () => {
    expect(tubeColor('invalid')).toBeUndefined();
    expect(tubeColor('notakey')).toBeUndefined();
    expect(tubeColor('xyz')).toBeUndefined();
  });

  it('resolves specific tube types with exact hex values', () => {
    expect(tubeColor('trace')?.hex).toBe('#1d4ed8');
    expect(tubeColor('sterile')?.hex).toBe('#e5e7eb');
    expect(tubeColor('multiple')?.hex).toBe('#6366f1');
  });
});

describe('tubeHex', () => {
  it('returns hex for known canonical keys', () => {
    expect(tubeHex('sst')).toBe('#eab308');
    expect(tubeHex('plain')).toBe('#ef4444');
    expect(tubeHex('edta')).toBe('#a855f7');
    expect(tubeHex('heparin')).toBe('#22c55e');
  });

  it('returns hex for legacy keys', () => {
    expect(tubeHex('red')).toBe('#ef4444');
    expect(tubeHex('gold')).toBe('#eab308');
    expect(tubeHex('blue')).toBe('#38bdf8');
  });

  it('returns neutral grey default for null, undefined, or unknown', () => {
    const defaultGrey = '#9ca3af';
    expect(tubeHex(null)).toBe(defaultGrey);
    expect(tubeHex(undefined)).toBe(defaultGrey);
    expect(tubeHex('')).toBe(defaultGrey);
    expect(tubeHex('unknown')).toBe(defaultGrey);
  });

  it('is case insensitive like tubeColor', () => {
    expect(tubeHex('SST')).toBe('#eab308');
    expect(tubeHex('PLAIN')).toBe('#ef4444');
  });
});

describe('Microbiology containers', () => {
  it('offers the Sterile container and the Blood culture bottle', () => {
    expect(tubeColor('sterile')?.label).toBe('Sterile Container');
    const bc = tubeColor('blood_culture');
    expect(bc?.label).toBe('Blood culture bottle');
    expect(bc?.short).toBe('BC bottle');
    expect(TUBE_COLORS.map(t => t.key)).toContain('blood_culture');
    expect(tubeHex('Blood_Culture')).toBe(bc?.hex);
  });
});
