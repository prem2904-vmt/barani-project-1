import { evaluateCondition, evaluateShowWhen, FieldValues } from './condition-evaluator';
import { ConditionRule, ShowWhen } from './form-field.model';

describe('evaluateCondition', () => {
  const values = (overrides: Partial<FieldValues> = {}): FieldValues => ({
    age: 25,
    status: 'active',
    score: 100,
    tags: ['a', 'b', 'c'],
    ...overrides,
  });

  describe('equals operator', () => {
    it('matches exact string values', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'equals', value: 'active' };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ status: 'pending' }))).toBe(false); // 'inactive' would CONTAIN 'act' — use a token that truly doesn't
    });

    it('matches exact numbers after string conversion', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'equals', value: 25 };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ age: 26 }))).toBe(false);
    });

    it('matches string numbers', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'equals', value: '25' };
      expect(evaluateCondition(rule, values())).toBe(true);
    });

    it('returns true when both are null', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'equals', value: null };
      expect(evaluateCondition(rule, values({}))).toBe(true);
    });

    it('returns false when only actual is null', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'equals', value: 'something' };
      expect(evaluateCondition(rule, values({}))).toBe(false);
    });

    it('returns false when only expected is null', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'equals', value: null };
      expect(evaluateCondition(rule, values())).toBe(false);
    });

    it('matches element in array against scalar value', () => {
      const rule: ConditionRule = { fieldId: 'tags', operator: 'equals', value: 'b' };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ tags: ['x', 'y', 'z'] }))).toBe(false);
    });
  });

  describe('notEquals operator', () => {
    it('returns opposite of equals', () => {
      const ruleEq: ConditionRule = { fieldId: 'status', operator: 'equals', value: 'active' };
      const ruleNe: ConditionRule = { fieldId: 'status', operator: 'notEquals', value: 'active' };
      expect(evaluateCondition(ruleNe, values())).toBe(!evaluateCondition(ruleEq, values()));
    });

    it('returns true when values differ', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'notEquals', value: 'inactive' };
      expect(evaluateCondition(rule, values())).toBe(true);
    });

    it('returns false when null vs null', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'notEquals', value: null };
      expect(evaluateCondition(rule, values({}))).toBe(false);
    });
  });

  describe('contains operator', () => {
    it('matches substring in string', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'contains', value: 'act' };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ status: 'pending' }))).toBe(false); // 'inactive' would CONTAIN 'act'
    });

    it('matches element in array', () => {
      const rule: ConditionRule = { fieldId: 'tags', operator: 'contains', value: 'b' };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ tags: ['x', 'y', 'z'] }))).toBe(false);
    });

    it('treats null as empty string', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'contains', value: 'test' };
      expect(evaluateCondition(rule, values({}))).toBe(false);
    });

    it('converts numbers to strings for matching', () => {
      const rule: ConditionRule = { fieldId: 'score', operator: 'contains', value: '10' };
      expect(evaluateCondition(rule, values())).toBe(true); // '100' contains '10'
    });
  });

  describe('notContains operator', () => {
    it('returns opposite of contains', () => {
      const ruleContains: ConditionRule = { fieldId: 'status', operator: 'contains', value: 'act' };
      const ruleNotContains: ConditionRule = { fieldId: 'status', operator: 'notContains', value: 'act' };
      expect(evaluateCondition(ruleNotContains, values())).toBe(!evaluateCondition(ruleContains, values()));
    });

    it('returns true when substring is not present', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'notContains', value: 'xyz' };
      expect(evaluateCondition(rule, values())).toBe(true);
    });
  });

  describe('isEmpty operator', () => {
    it('returns true for null', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values({}))).toBe(true);
    });

    it('returns true for undefined (missing field)', () => {
      const rule: ConditionRule = { fieldId: 'nonexistent', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values())).toBe(true);
    });

    it('returns true for empty string', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values({ status: '' }))).toBe(true);
    });

    it('returns true for whitespace-only string', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values({ status: '   ' }))).toBe(true);
    });

    it('returns true for empty array', () => {
      const rule: ConditionRule = { fieldId: 'tags', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values({ tags: [] }))).toBe(true);
    });

    it('returns true for empty object', () => {
      const rule: ConditionRule = { fieldId: 'data', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values({ data: {} }))).toBe(true);
    });

    it('returns false for non-empty value', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values())).toBe(false);
    });

    it('returns false for number zero', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values({ age: 0 }))).toBe(false);
    });

    it('returns false for boolean false', () => {
      const rule: ConditionRule = { fieldId: 'flag', operator: 'isEmpty' };
      expect(evaluateCondition(rule, values({ flag: false }))).toBe(false);
    });
  });

  describe('isNotEmpty operator', () => {
    it('returns opposite of isEmpty', () => {
      const ruleEmpty: ConditionRule = { fieldId: 'status', operator: 'isEmpty' };
      const ruleNotEmpty: ConditionRule = { fieldId: 'status', operator: 'isNotEmpty' };
      expect(evaluateCondition(ruleNotEmpty, values())).toBe(!evaluateCondition(ruleEmpty, values()));
    });

    it('returns true for non-empty value', () => {
      const rule: ConditionRule = { fieldId: 'status', operator: 'isNotEmpty' };
      expect(evaluateCondition(rule, values())).toBe(true);
    });

    it('returns false for null', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'isNotEmpty' };
      expect(evaluateCondition(rule, values({}))).toBe(false);
    });
  });

  describe('greaterThan operator', () => {
    it('compares numbers correctly', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'greaterThan', value: 20 };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ age: 20 }))).toBe(false);
      expect(evaluateCondition(rule, values({ age: 19 }))).toBe(false);
    });

    it('parses string numbers', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'greaterThan', value: '20' };
      expect(evaluateCondition(rule, values())).toBe(true);
    });

    it('returns false when comparing to NaN (missing value)', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'greaterThan', value: 10 };
      expect(evaluateCondition(rule, values({}))).toBe(false);
    });

    it('returns false when expected value is NaN', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'greaterThan', value: 'not-a-number' };
      expect(evaluateCondition(rule, values())).toBe(false);
    });
  });

  describe('lessThan operator', () => {
    it('compares numbers correctly', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'lessThan', value: 30 };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ age: 30 }))).toBe(false);
      expect(evaluateCondition(rule, values({ age: 31 }))).toBe(false);
    });

    it('parses string numbers', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'lessThan', value: '30' };
      expect(evaluateCondition(rule, values())).toBe(true);
    });

    it('returns false with NaN values', () => {
      const rule: ConditionRule = { fieldId: 'missing', operator: 'lessThan', value: 10 };
      expect(evaluateCondition(rule, values({}))).toBe(false);
    });
  });

  describe('greaterThanOrEqual operator', () => {
    it('compares numbers correctly', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'greaterThanOrEqual', value: 25 };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ age: 25 }))).toBe(true);
      expect(evaluateCondition(rule, values({ age: 24 }))).toBe(false);
    });
  });

  describe('lessThanOrEqual operator', () => {
    it('compares numbers correctly', () => {
      const rule: ConditionRule = { fieldId: 'age', operator: 'lessThanOrEqual', value: 25 };
      expect(evaluateCondition(rule, values())).toBe(true);
      expect(evaluateCondition(rule, values({ age: 25 }))).toBe(true);
      expect(evaluateCondition(rule, values({ age: 26 }))).toBe(false);
    });
  });

  describe('missing field handling', () => {
    it('treats undefined field as null for most operators', () => {
      const ruleEq: ConditionRule = { fieldId: 'nonexistent', operator: 'equals', value: 'value' };
      const ruleEmpty: ConditionRule = { fieldId: 'nonexistent', operator: 'isEmpty' };
      expect(evaluateCondition(ruleEq, values())).toBe(false);
      expect(evaluateCondition(ruleEmpty, values())).toBe(true);
    });
  });

  describe('invalid operator', () => {
    it('returns false for unknown operator', () => {
      const rule = { fieldId: 'age', operator: 'unknownOp' } as any;
      expect(evaluateCondition(rule, values())).toBe(false);
    });
  });
});

describe('evaluateShowWhen', () => {
  const values = (overrides: Partial<FieldValues> = {}): FieldValues => ({
    field1: 'active',
    field2: 'approved',
    field3: 100,
    ...overrides,
  });

  describe('null and undefined handling', () => {
    it('returns true when showWhen is null', () => {
      expect(evaluateShowWhen(null, values())).toBe(true);
    });

    it('returns true when showWhen is undefined', () => {
      expect(evaluateShowWhen(undefined, values())).toBe(true);
    });

    it('returns true when conditions array is empty', () => {
      const showWhen: ShowWhen = { logic: 'AND', conditions: [] };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('returns true when conditions is null', () => {
      const showWhen: ShowWhen = { logic: 'AND', conditions: null as any };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('returns true when conditions is undefined', () => {
      const showWhen: ShowWhen = { logic: 'AND', conditions: undefined as any };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });
  });

  describe('AND logic (every condition must match)', () => {
    it('returns true when all conditions match', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'field2', operator: 'equals', value: 'approved' },
          { fieldId: 'field3', operator: 'greaterThan', value: 50 },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('returns false when one condition fails', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'field2', operator: 'equals', value: 'rejected' },
          { fieldId: 'field3', operator: 'greaterThan', value: 50 },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(false);
    });

    it('returns false when all conditions fail', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
          { fieldId: 'field2', operator: 'equals', value: 'rejected' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(false);
    });

    it('returns true with single matching condition', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });
  });

  describe('OR logic (at least one condition must match)', () => {
    it('returns true when all conditions match', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'field2', operator: 'equals', value: 'approved' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('returns true when one condition matches', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'field2', operator: 'equals', value: 'rejected' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('returns false when no condition matches', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
          { fieldId: 'field2', operator: 'equals', value: 'rejected' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(false);
    });

    it('returns true with single matching condition', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('returns false with single non-matching condition', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(false);
    });
  });

  describe('visibility: show (default)', () => {
    it('returns the combined result as-is (AND)', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        visibility: 'show',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'field2', operator: 'equals', value: 'approved' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('returns the combined result as-is when conditions fail', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        visibility: 'show',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(false);
    });
  });

  describe('visibility: hide (inverted)', () => {
    it('inverts true result to false', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        visibility: 'hide',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'field2', operator: 'equals', value: 'approved' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(false);
    });

    it('inverts false result to true', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        visibility: 'hide',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('inverts OR results', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        visibility: 'hide',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
          { fieldId: 'field2', operator: 'equals', value: 'rejected' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('handles multiple conditions with mixed operators (AND)', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'field3', operator: 'greaterThanOrEqual', value: 100 },
          { fieldId: 'field2', operator: 'notEquals', value: 'rejected' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('handles multiple conditions with mixed operators (OR)', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
          { fieldId: 'field3', operator: 'lessThan', value: 50 },
          { fieldId: 'field2', operator: 'equals', value: 'approved' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('evaluates empty/contains conditions', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'isNotEmpty' },
          { fieldId: 'field2', operator: 'contains', value: 'app' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('handles missing fields in conditions', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
          { fieldId: 'missingField', operator: 'isEmpty' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('combines visibility:hide with complex conditions', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        visibility: 'hide',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'inactive' },
          { fieldId: 'field2', operator: 'equals', value: 'rejected' },
        ],
      };
      // All conditions fail (OR returns false), hide inverts to true
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles conditions with undefined visibility (defaults to show)', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'field1', operator: 'equals', value: 'active' },
        ],
      };
      expect(evaluateShowWhen(showWhen, values())).toBe(true);
    });

    it('handles many conditions (large AND)', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: Array.from({ length: 10 }, (_, i) => ({
          fieldId: `field${i}`,
          operator: 'isNotEmpty' as const,
        })),
      };
      const largeValues: FieldValues = Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`field${i}`, `value${i}`])
      );
      expect(evaluateShowWhen(showWhen, largeValues)).toBe(true);
    });

    it('handles many conditions (large OR, one fails)', () => {
      const showWhen: ShowWhen = {
        logic: 'OR',
        conditions: Array.from({ length: 10 }, (_, i) => ({
          fieldId: `field${i}`,
          operator: 'equals' as const,
          value: `wrong${i}`,
        })),
      };
      const largeValues: FieldValues = Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`field${i}`, `value${i}`])
      );
      expect(evaluateShowWhen(showWhen, largeValues)).toBe(false);
    });

    it('works with empty field values object', () => {
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'missing1', operator: 'isEmpty' },
          { fieldId: 'missing2', operator: 'isEmpty' },
        ],
      };
      expect(evaluateShowWhen(showWhen, {})).toBe(true);
    });

    it('works with various data types in values', () => {
      const complexValues: FieldValues = {
        str: 'text',
        num: 42,
        bool: true,
        arr: [1, 2, 3],
        obj: { key: 'value' },
        nil: null,
        undef: undefined,
      };
      const showWhen: ShowWhen = {
        logic: 'AND',
        conditions: [
          { fieldId: 'str', operator: 'equals', value: 'text' },
          { fieldId: 'num', operator: 'greaterThan', value: 40 },
          { fieldId: 'bool', operator: 'isNotEmpty' },
          { fieldId: 'arr', operator: 'contains', value: 2 },
          { fieldId: 'nil', operator: 'isEmpty' },
        ],
      };
      expect(evaluateShowWhen(showWhen, complexValues)).toBe(true);
    });
  });
});
