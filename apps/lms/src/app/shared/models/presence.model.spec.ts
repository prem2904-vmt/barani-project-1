import { PRESENCE_OPTIONS, isPresenceKey, presenceLabel, presenceColor, presenceIsDnd } from './presence.model';

describe('PRESENCE_OPTIONS', () => {
  it('exports exactly 7 preset options with all required fields', () => {
    expect(PRESENCE_OPTIONS).toHaveLength(7);
    PRESENCE_OPTIONS.forEach((opt) => {
      expect(opt).toHaveProperty('key');
      expect(opt).toHaveProperty('label');
      expect(opt).toHaveProperty('color');
      expect(opt).toHaveProperty('dnd');
      expect(typeof opt.key).toBe('string');
      expect(typeof opt.label).toBe('string');
      expect(typeof opt.color).toBe('string');
      expect(typeof opt.dnd).toBe('boolean');
    });
  });

  it('has correct keys in order: available, busy, with_patient, rounds, surgery, dnd, away', () => {
    const keys = PRESENCE_OPTIONS.map(o => o.key);
    expect(keys).toEqual(['available', 'busy', 'with_patient', 'rounds', 'surgery', 'dnd', 'away']);
  });

  it('marks only surgery and dnd as DPF-grade (calls blocked, pushes silenced)', () => {
    const dndStatuses = PRESENCE_OPTIONS.filter(o => o.dnd).map(o => o.key);
    expect(dndStatuses).toEqual(['surgery', 'dnd']);
  });

  it('assigns distinct human labels to each status', () => {
    const labels = PRESENCE_OPTIONS.map(o => o.label);
    expect(new Set(labels).size).toBe(7);
    expect(labels).toContain('Available');
    expect(labels).toContain('Busy');
    expect(labels).toContain('With a patient');
    expect(labels).toContain('On rounds');
    expect(labels).toContain('In surgery');
    expect(labels).toContain('Do not disturb');
    expect(labels).toContain('Away');
  });

  it('uses red (#dc2626) for DND statuses and other colors for non-DND', () => {
    const dndOpts = PRESENCE_OPTIONS.filter(o => o.dnd);
    dndOpts.forEach(opt => {
      expect(opt.color).toBe('#dc2626');
    });
    const nonDnd = PRESENCE_OPTIONS.filter(o => !o.dnd);
    nonDnd.forEach(opt => {
      expect(opt.color).not.toBe('#dc2626');
    });
  });

  it('has specific color assignments for each status', () => {
    const byKey = new Map(PRESENCE_OPTIONS.map(o => [o.key, o]));
    expect(byKey.get('available')?.color).toBe('#34d399');
    expect(byKey.get('busy')?.color).toBe('#f87171');
    expect(byKey.get('with_patient')?.color).toBe('#f87171');
    expect(byKey.get('rounds')?.color).toBe('#fbbf24');
    expect(byKey.get('surgery')?.color).toBe('#dc2626');
    expect(byKey.get('dnd')?.color).toBe('#dc2626');
    expect(byKey.get('away')?.color).toBe('#9ca3af');
  });
});

describe('isPresenceKey', () => {
  it('returns true for all valid keys', () => {
    expect(isPresenceKey('available')).toBe(true);
    expect(isPresenceKey('busy')).toBe(true);
    expect(isPresenceKey('with_patient')).toBe(true);
    expect(isPresenceKey('rounds')).toBe(true);
    expect(isPresenceKey('surgery')).toBe(true);
    expect(isPresenceKey('dnd')).toBe(true);
    expect(isPresenceKey('away')).toBe(true);
  });

  it('returns false for invalid keys', () => {
    expect(isPresenceKey('unknown')).toBe(false);
    expect(isPresenceKey('offline')).toBe(false);
    expect(isPresenceKey('active')).toBe(false);
    expect(isPresenceKey('AVAILABLE')).toBe(false);
    expect(isPresenceKey('')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isPresenceKey(null)).toBe(false);
    expect(isPresenceKey(undefined)).toBe(false);
  });

  it('works as a type guard in TypeScript narrowing', () => {
    const value: string | null = 'busy';
    if (isPresenceKey(value)) {
      expect(value).toBe('busy');
    }
  });
});

describe('presenceLabel', () => {
  it('returns correct labels for each valid key', () => {
    expect(presenceLabel('available')).toBe('Available');
    expect(presenceLabel('busy')).toBe('Busy');
    expect(presenceLabel('with_patient')).toBe('With a patient');
    expect(presenceLabel('rounds')).toBe('On rounds');
    expect(presenceLabel('surgery')).toBe('In surgery');
    expect(presenceLabel('dnd')).toBe('Do not disturb');
    expect(presenceLabel('away')).toBe('Away');
  });

  it('returns empty string for unknown keys', () => {
    expect(presenceLabel('unknown')).toBe('');
    expect(presenceLabel('offline')).toBe('');
    expect(presenceLabel('active')).toBe('');
    expect(presenceLabel('AVAILABLE')).toBe('');
  });

  it('returns empty string for null and undefined', () => {
    expect(presenceLabel(null)).toBe('');
    expect(presenceLabel(undefined)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(presenceLabel('')).toBe('');
  });
});

describe('presenceColor', () => {
  it('returns correct colors for each valid key', () => {
    expect(presenceColor('available')).toBe('#34d399');
    expect(presenceColor('busy')).toBe('#f87171');
    expect(presenceColor('with_patient')).toBe('#f87171');
    expect(presenceColor('rounds')).toBe('#fbbf24');
    expect(presenceColor('surgery')).toBe('#dc2626');
    expect(presenceColor('dnd')).toBe('#dc2626');
    expect(presenceColor('away')).toBe('#9ca3af');
  });

  it('returns neutral grey (#9ca3af) for unknown keys', () => {
    expect(presenceColor('unknown')).toBe('#9ca3af');
    expect(presenceColor('offline')).toBe('#9ca3af');
    expect(presenceColor('active')).toBe('#9ca3af');
    expect(presenceColor('AVAILABLE')).toBe('#9ca3af');
  });

  it('returns neutral grey for null and undefined', () => {
    expect(presenceColor(null)).toBe('#9ca3af');
    expect(presenceColor(undefined)).toBe('#9ca3af');
  });

  it('returns neutral grey for empty string input', () => {
    expect(presenceColor('')).toBe('#9ca3af');
  });
});

describe('presenceIsDnd', () => {
  it('returns true for DPF-grade statuses (surgery and dnd)', () => {
    expect(presenceIsDnd('surgery')).toBe(true);
    expect(presenceIsDnd('dnd')).toBe(true);
  });

  it('returns false for non-DND statuses', () => {
    expect(presenceIsDnd('available')).toBe(false);
    expect(presenceIsDnd('busy')).toBe(false);
    expect(presenceIsDnd('with_patient')).toBe(false);
    expect(presenceIsDnd('rounds')).toBe(false);
    expect(presenceIsDnd('away')).toBe(false);
  });

  it('returns false for unknown keys', () => {
    expect(presenceIsDnd('unknown')).toBe(false);
    expect(presenceIsDnd('offline')).toBe(false);
    expect(presenceIsDnd('active')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(presenceIsDnd(null)).toBe(false);
    expect(presenceIsDnd(undefined)).toBe(false);
  });

  it('returns false for empty string input', () => {
    expect(presenceIsDnd('')).toBe(false);
  });
});
