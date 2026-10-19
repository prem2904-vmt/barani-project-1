import {
  INDIA_STATES,
  INDIA_CITIES_BY_STATE,
  citiesForState,
  OTHER_CITY_VALUE,
  cityOptionsForState,
  stateOptions,
} from './india-locations';

describe('india-locations', () => {
  describe('INDIA_STATES', () => {
    it('is a non-empty readonly array', () => {
      expect(Array.isArray(INDIA_STATES)).toBe(true);
      expect(INDIA_STATES.length).toBeGreaterThan(0);
    });

    it('contains 36 states and union territories', () => {
      expect(INDIA_STATES.length).toBe(36);
    });

    it('has no duplicate entries', () => {
      const unique = new Set(INDIA_STATES);
      expect(unique.size).toBe(INDIA_STATES.length);
    });

    it('includes major states and union territories', () => {
      expect(INDIA_STATES).toContain('Maharashtra');
      expect(INDIA_STATES).toContain('Delhi');
      expect(INDIA_STATES).toContain('Karnataka');
      expect(INDIA_STATES).toContain('Tamil Nadu');
      expect(INDIA_STATES).toContain('Andhra Pradesh');
      // Union territories
      expect(INDIA_STATES).toContain('Chandigarh');
      expect(INDIA_STATES).toContain('Ladakh');
    });
  });

  describe('INDIA_CITIES_BY_STATE', () => {
    it('is a readonly record object', () => {
      expect(typeof INDIA_CITIES_BY_STATE).toBe('object');
      expect(INDIA_CITIES_BY_STATE !== null).toBe(true);
    });

    it('has no duplicate keys', () => {
      const keys = Object.keys(INDIA_CITIES_BY_STATE);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    it('contains all states from INDIA_STATES as keys', () => {
      const keys = new Set(Object.keys(INDIA_CITIES_BY_STATE));
      for (const state of INDIA_STATES) {
        expect(keys.has(state)).toBe(true);
      }
    });

    it('has no empty city arrays', () => {
      for (const [state, cities] of Object.entries(INDIA_CITIES_BY_STATE)) {
        expect(Array.isArray(cities)).toBe(true);
        expect(cities.length).toBeGreaterThan(0);
      }
    });

    it('has no duplicate cities within a state', () => {
      for (const [state, cities] of Object.entries(INDIA_CITIES_BY_STATE)) {
        const unique = new Set(cities);
        expect(unique.size).toBe(cities.length);
      }
    });

    it('contains known city mappings', () => {
      expect(INDIA_CITIES_BY_STATE['Maharashtra']).toContain('Mumbai');
      expect(INDIA_CITIES_BY_STATE['Maharashtra']).toContain('Pune');
      expect(INDIA_CITIES_BY_STATE['Karnataka']).toContain('Bengaluru');
      expect(INDIA_CITIES_BY_STATE['Delhi']).toContain('New Delhi');
      expect(INDIA_CITIES_BY_STATE['Tamil Nadu']).toContain('Chennai');
    });
  });

  describe('citiesForState', () => {
    it('returns city array for a known state', () => {
      const cities = citiesForState('Maharashtra');
      expect(Array.isArray(cities)).toBe(true);
      expect(cities.length).toBeGreaterThan(0);
      expect(cities).toContain('Mumbai');
    });

    it('returns empty array for unknown state', () => {
      const cities = citiesForState('UnknownState');
      expect(cities).toEqual([]);
    });

    it('returns empty array for empty string state', () => {
      const cities = citiesForState('');
      expect(cities).toEqual([]);
    });

    it('returns empty array for null-like input', () => {
      const cities = citiesForState(null as any);
      expect(cities).toEqual([]);
    });

    it('is case-sensitive for state names', () => {
      const cities = citiesForState('maharashtra');
      expect(cities).toEqual([]);
    });
  });

  describe('OTHER_CITY_VALUE', () => {
    it('is a string constant for the other option', () => {
      expect(typeof OTHER_CITY_VALUE).toBe('string');
    });

    it('equals the sentinel value __other__', () => {
      expect(OTHER_CITY_VALUE).toBe('__other__');
    });
  });

  describe('cityOptionsForState', () => {
    it('returns array of value/label objects for known state', () => {
      const options = cityOptionsForState('Maharashtra');
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveProperty('value');
      expect(options[0]).toHaveProperty('label');
    });

    it('includes all cities from citiesForState plus one Other option', () => {
      const cities = citiesForState('Karnataka');
      const options = cityOptionsForState('Karnataka');
      expect(options.length).toBe(cities.length + 1);
    });

    it('ends with the Other option', () => {
      const options = cityOptionsForState('Delhi');
      const lastOption = options[options.length - 1];
      expect(lastOption.value).toBe(OTHER_CITY_VALUE);
      expect(lastOption.label).toContain('Other');
    });

    it('maps city names to both value and label for non-Other items', () => {
      const options = cityOptionsForState('Punjab');
      const cityOptions = options.slice(0, -1);
      for (const opt of cityOptions) {
        expect(opt.value).toBe(opt.label);
      }
    });

    it('returns only the Other option for unknown state', () => {
      const options = cityOptionsForState('UnknownState');
      expect(options.length).toBe(1);
      expect(options[0].value).toBe(OTHER_CITY_VALUE);
    });
  });

  describe('stateOptions', () => {
    it('returns array of value/label objects', () => {
      const options = stateOptions();
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveProperty('value');
      expect(options[0]).toHaveProperty('label');
    });

    it('returns all states from INDIA_STATES', () => {
      const options = stateOptions();
      expect(options.length).toBe(INDIA_STATES.length);
    });

    it('maps value to label for each state', () => {
      const options = stateOptions();
      for (const opt of options) {
        expect(opt.value).toBe(opt.label);
        expect(INDIA_STATES).toContain(opt.value);
      }
    });

    it('includes known states in the correct order', () => {
      const options = stateOptions();
      const values = options.map((o) => o.value);
      // Verify some known states are present at expected positions
      expect(values).toEqual(INDIA_STATES as unknown as string[]);
    });
  });
});
