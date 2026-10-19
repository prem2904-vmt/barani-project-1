import { portablePanel, PORTABLE_PANELS, PortablePanel } from './portable-panels';

describe('PORTABLE_PANELS', () => {
  it('is an array of registered portable panels', () => {
    expect(Array.isArray(PORTABLE_PANELS)).toBe(true);
  });

  it('contains the appointment panel with correct structure', () => {
    const appt = PORTABLE_PANELS.find(p => p.type === 'appointment');
    expect(appt).toBeDefined();
    expect(appt?.type).toBe('appointment');
    expect(appt?.native).toBe('frontdesk');
    expect(appt?.label).toBe('Appointments');
    expect(typeof appt?.load).toBe('function');
  });

  it('has at least one panel registered', () => {
    expect(PORTABLE_PANELS.length).toBeGreaterThanOrEqual(1);
  });

  it('all entries have required properties', () => {
    PORTABLE_PANELS.forEach((panel) => {
      expect(panel.type).toBeDefined();
      expect(typeof panel.type).toBe('string');
      expect(panel.native).toBeDefined();
      expect(typeof panel.native).toBe('string');
      expect(panel.label).toBeDefined();
      expect(typeof panel.label).toBe('string');
      expect(panel.load).toBeDefined();
      expect(typeof panel.load).toBe('function');
    });
  });

  it('panel types are unique', () => {
    const types = PORTABLE_PANELS.map(p => p.type);
    const uniqueTypes = new Set(types);
    expect(uniqueTypes.size).toBe(types.length);
  });
});

describe('portablePanel', () => {
  it('finds and returns the appointment panel by exact type match', () => {
    const panel = portablePanel('appointment');
    expect(panel).toBeDefined();
    expect(panel?.type).toBe('appointment');
    expect(panel?.native).toBe('frontdesk');
    expect(panel?.label).toBe('Appointments');
  });

  it('returns undefined for non-existent panel type', () => {
    expect(portablePanel('billing')).toBeUndefined();
    expect(portablePanel('queue')).toBeUndefined();
    expect(portablePanel('results')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(portablePanel('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(portablePanel('  ')).toBeUndefined();
    expect(portablePanel('\t')).toBeUndefined();
  });

  it('is case-sensitive (does not match partial or case-variant types)', () => {
    expect(portablePanel('Appointment')).toBeUndefined();
    expect(portablePanel('APPOINTMENT')).toBeUndefined();
    expect(portablePanel('appoint')).toBeUndefined();
  });

  it('returns the first match only (deduplication safe)', () => {
    // Even if PORTABLE_PANELS somehow had duplicates, only the first match is returned
    const panel = portablePanel('appointment');
    expect(panel).toEqual(PORTABLE_PANELS.find(p => p.type === 'appointment'));
  });

  it('returned panel has a loadable component function', async () => {
    const panel = portablePanel('appointment');
    expect(panel?.load).toBeDefined();
    expect(typeof panel?.load).toBe('function');
    // The load function should return a Promise
    const loadPromise = panel?.load();
    expect(loadPromise instanceof Promise).toBe(true);
  });

  it('does not mutate the array when searching', () => {
    const lengthBefore = PORTABLE_PANELS.length;
    portablePanel('appointment');
    portablePanel('nonexistent');
    expect(PORTABLE_PANELS.length).toBe(lengthBefore);
  });
});
