import { KpiStripComponent } from './kpi-strip.component';

describe('KpiStripComponent formatters', () => {
  // Component requires ApiService injection, so test methods via prototype.call()
  const callMethod = <T,>(method: (...args: any[]) => T, context: any, ...args: any[]): T =>
    method.call(context, ...args);

  describe('round', () => {
    const round = KpiStripComponent.prototype['round'];

    it('formats decimals to the specified precision and strips trailing zeros', () => {
      // v.toFixed(p).replace(/\.0+$/, '')
      expect(callMethod(round, {}, 3.14159, 2)).toBe('3.14');
      expect(callMethod(round, {}, 5, 1)).toBe('5');
      expect(callMethod(round, {}, 5, 2)).toBe('5');
      expect(callMethod(round, {}, 10.5, 1)).toBe('10.5');
    });

    it('handles zero', () => {
      expect(callMethod(round, {}, 0, 1)).toBe('0');
      expect(callMethod(round, {}, 0, 2)).toBe('0');
    });

    it('handles negative numbers', () => {
      expect(callMethod(round, {}, -3.14159, 2)).toBe('-3.14');
      expect(callMethod(round, {}, -5, 1)).toBe('-5');
    });

    it('rounds to nearest at precision boundary', () => {
      expect(callMethod(round, {}, 1.5, 0)).toBe('2');
      expect(callMethod(round, {}, 1.4, 0)).toBe('1');
    });
  });

  describe('formatCount', () => {
    const formatCount = KpiStripComponent.prototype['formatCount'];

    it('formats small counts as plain numbers', () => {
      expect(callMethod(formatCount, {}, 0)).toBe('0');
      expect(callMethod(formatCount, {}, 1)).toBe('1');
      expect(callMethod(formatCount, {}, 999)).toBe('999');
    });

    it('formats thousands with k suffix and strips .0', () => {
      expect(callMethod(formatCount, {}, 1000)).toBe('1k');
      expect(callMethod(formatCount, {}, 1500)).toBe('1.5k');
      expect(callMethod(formatCount, {}, 10000)).toBe('10k');
      expect(callMethod(formatCount, {}, 10500)).toBe('10.5k');
    });

    it('handles boundary at 1000', () => {
      expect(callMethod(formatCount, {}, 999)).toBe('999');
      expect(callMethod(formatCount, {}, 1000)).toBe('1k');
      expect(callMethod(formatCount, {}, 1001)).toBe('1k');
    });

    it('rounds when converting to thousands', () => {
      expect(callMethod(formatCount, {}, 1499)).toBe('1.5k');
      expect(callMethod(formatCount, {}, 1440)).toBe('1.4k');
    });

    it('handles negative counts', () => {
      expect(callMethod(formatCount, {}, -500)).toBe('-500');
      expect(callMethod(formatCount, {}, -1500)).toBe('-1500');
    });

    it('handles large counts', () => {
      expect(callMethod(formatCount, {}, 999999)).toBe('1000k');
      expect(callMethod(formatCount, {}, 1000000)).toBe('1000k');
    });
  });

  describe('formatCurrency', () => {
    const formatCurrency = KpiStripComponent.prototype['formatCurrency'];

    it('formats small amounts with ₹ symbol and toLocaleString for en-IN', () => {
      expect(callMethod(formatCurrency, {}, 0)).toBe('₹0');
      expect(callMethod(formatCurrency, {}, 100)).toBe('₹100');
      expect(callMethod(formatCurrency, {}, 999)).toBe('₹999');
      expect(callMethod(formatCurrency, {}, 500)).toBe('₹500');
    });

    it('formats at k threshold (>= 1000)', () => {
      expect(callMethod(formatCurrency, {}, 1000)).toBe('₹1k');
      expect(callMethod(formatCurrency, {}, 1500)).toBe('₹1.5k');
      expect(callMethod(formatCurrency, {}, 10000)).toBe('₹10k');
      expect(callMethod(formatCurrency, {}, 50000)).toBe('₹50k');
    });

    it('formats lakhs with L suffix when >= 100k', () => {
      expect(callMethod(formatCurrency, {}, 100000)).toBe('₹1L');
      expect(callMethod(formatCurrency, {}, 150000)).toBe('₹1.5L');
      expect(callMethod(formatCurrency, {}, 1000000)).toBe('₹10L');
      expect(callMethod(formatCurrency, {}, 5000000)).toBe('₹50L');
    });

    it('formats crores with Cr suffix when >= 10M', () => {
      expect(callMethod(formatCurrency, {}, 10000000)).toBe('₹1Cr');
      expect(callMethod(formatCurrency, {}, 15000000)).toBe('₹1.5Cr');
      expect(callMethod(formatCurrency, {}, 100000000)).toBe('₹10Cr');
    });

    it('strips trailing .0 from scaled values', () => {
      expect(callMethod(formatCurrency, {}, 2000)).toBe('₹2k');
      expect(callMethod(formatCurrency, {}, 200000)).toBe('₹2L');
      expect(callMethod(formatCurrency, {}, 20000000)).toBe('₹2Cr');
    });

    it('handles boundary transitions', () => {
      expect(callMethod(formatCurrency, {}, 999)).toBe('₹999');
      expect(callMethod(formatCurrency, {}, 1000)).toBe('₹1k');
      expect(callMethod(formatCurrency, {}, 99999)).toBe('₹100k');
      expect(callMethod(formatCurrency, {}, 100000)).toBe('₹1L');
      expect(callMethod(formatCurrency, {}, 9999999)).toBe('₹100L');
      expect(callMethod(formatCurrency, {}, 10000000)).toBe('₹1Cr');
    });

    it('handles negative amounts (no scaling for negatives since they fail >= checks)', () => {
      expect(callMethod(formatCurrency, {}, -500)).toBe('₹-500');
      expect(callMethod(formatCurrency, {}, -1500)).toBe('₹-1,500');
      expect(callMethod(formatCurrency, {}, -100000)).toBe('₹-1,00,000');
    });
  });

  describe('formatDuration', () => {
    const formatDuration = KpiStripComponent.prototype['formatDuration'];
    const round = KpiStripComponent.prototype['round'];

    // Context with round method for formatDuration to call
    const durationContext = () => ({ round });

    it('formats minutes under 60 as m', () => {
      expect(callMethod(formatDuration, durationContext(), 0)).toBe('0m');
      expect(callMethod(formatDuration, durationContext(), 1)).toBe('1m');
      expect(callMethod(formatDuration, durationContext(), 30)).toBe('30m');
      expect(callMethod(formatDuration, durationContext(), 59)).toBe('59m');
    });

    it('formats hours >= 60 as h with 1 decimal place', () => {
      expect(callMethod(formatDuration, durationContext(), 60)).toBe('1h');
      expect(callMethod(formatDuration, durationContext(), 90)).toBe('1.5h');
      expect(callMethod(formatDuration, durationContext(), 120)).toBe('2h');
      expect(callMethod(formatDuration, durationContext(), 1439)).toBe('24h');
    });

    it('formats days >= 1440 as d with 1 decimal place', () => {
      expect(callMethod(formatDuration, durationContext(), 1440)).toBe('1d');
      expect(callMethod(formatDuration, durationContext(), 2160)).toBe('1.5d');
      expect(callMethod(formatDuration, durationContext(), 2880)).toBe('2d');
      expect(callMethod(formatDuration, durationContext(), 10080)).toBe('7d');
    });

    it('handles boundaries correctly', () => {
      expect(callMethod(formatDuration, durationContext(), 59)).toBe('59m');
      expect(callMethod(formatDuration, durationContext(), 60)).toBe('1h');
      expect(callMethod(formatDuration, durationContext(), 1439)).toBe('24h');
      expect(callMethod(formatDuration, durationContext(), 1440)).toBe('1d');
    });

    it('rounds durations per unit', () => {
      expect(callMethod(formatDuration, durationContext(), 65)).toBe('1.1h');
      expect(callMethod(formatDuration, durationContext(), 75)).toBe('1.3h');
      expect(callMethod(formatDuration, durationContext(), 1500)).toBe('1d');
    });

    it('strips trailing .0 from rounded hours and days', () => {
      expect(callMethod(formatDuration, durationContext(), 120)).toBe('2h');
      expect(callMethod(formatDuration, durationContext(), 2880)).toBe('2d');
    });

    it('handles negative durations (no scaling)', () => {
      expect(callMethod(formatDuration, durationContext(), -30)).toBe('-30m');
      expect(callMethod(formatDuration, durationContext(), -120)).toBe('-120m');
    });
  });

  describe('formatValue', () => {
    const formatValue = KpiStripComponent.prototype.formatValue;
    const round = KpiStripComponent.prototype['round'];
    const formatCount = KpiStripComponent.prototype['formatCount'];
    const formatCurrency = KpiStripComponent.prototype['formatCurrency'];
    const formatDuration = KpiStripComponent.prototype['formatDuration'];

    // Create context object with bound private methods for formatValue
    const createContext = () => ({
      round,
      formatCount,
      formatCurrency,
      formatDuration,
    });

    it('routes count type to formatCount', () => {
      expect(formatValue.call(createContext(), { valueType: 'count', value: 1500 } as any)).toBe('1.5k');
      expect(formatValue.call(createContext(), { valueType: 'count', value: 100 } as any)).toBe('100');
    });

    it('routes currency type to formatCurrency', () => {
      expect(formatValue.call(createContext(), { valueType: 'currency', value: 150000 } as any)).toBe('₹1.5L');
      expect(formatValue.call(createContext(), { valueType: 'currency', value: 1000 } as any)).toBe('₹1k');
    });

    it('formats percent type with round(value, 1)%', () => {
      expect(formatValue.call(createContext(), { valueType: 'percent', value: 75.5 } as any)).toBe('75.5%');
      expect(formatValue.call(createContext(), { valueType: 'percent', value: 80 } as any)).toBe('80%');
      expect(formatValue.call(createContext(), { valueType: 'percent', value: 33.33 } as any)).toBe('33.3%');
    });

    it('routes duration_minutes type to formatDuration', () => {
      expect(formatValue.call(createContext(), { valueType: 'duration_minutes', value: 90 } as any)).toBe('1.5h');
      expect(formatValue.call(createContext(), { valueType: 'duration_minutes', value: 30 } as any)).toBe('30m');
      expect(formatValue.call(createContext(), { valueType: 'duration_minutes', value: 2880 } as any)).toBe('2d');
    });

    it('defaults unknown types to formatCount', () => {
      expect(formatValue.call(createContext(), { valueType: 'unknown', value: 1500 } as any)).toBe('1.5k');
      expect(formatValue.call(createContext(), { valueType: '', value: 100 } as any)).toBe('100');
    });

    it('handles zero across all types', () => {
      expect(formatValue.call(createContext(), { valueType: 'count', value: 0 } as any)).toBe('0');
      expect(formatValue.call(createContext(), { valueType: 'currency', value: 0 } as any)).toBe('₹0');
      expect(formatValue.call(createContext(), { valueType: 'percent', value: 0 } as any)).toBe('0%');
      expect(formatValue.call(createContext(), { valueType: 'duration_minutes', value: 0 } as any)).toBe('0m');
    });

    it('handles negative values across all types', () => {
      expect(formatValue.call(createContext(), { valueType: 'count', value: -500 } as any)).toBe('-500');
      expect(formatValue.call(createContext(), { valueType: 'currency', value: -1500 } as any)).toBe('₹-1,500');
      expect(formatValue.call(createContext(), { valueType: 'percent', value: -25.5 } as any)).toBe('-25.5%');
      expect(formatValue.call(createContext(), { valueType: 'duration_minutes', value: -120 } as any)).toBe('-120m');
    });
  });
});
