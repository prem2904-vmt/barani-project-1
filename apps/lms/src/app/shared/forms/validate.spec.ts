import {
  COUNTRY_PHONE_RULES,
  getCountryPhoneRule,
  validatePhoneNumber,
  validateFieldValue,
  isNumericType,
  isMultiSelectType,
  supportsLengthValidation,
  supportsPatternValidation,
  CountryPhoneRule,
  ValidatableField,
} from './validate';

describe('COUNTRY_PHONE_RULES', () => {
  it('exports an array of phone rules for 8 countries', () => {
    expect(Array.isArray(COUNTRY_PHONE_RULES)).toBe(true);
    expect(COUNTRY_PHONE_RULES.length).toBe(8);
  });

  it('each rule has required properties', () => {
    COUNTRY_PHONE_RULES.forEach((rule: CountryPhoneRule) => {
      expect(rule.code).toBeDefined();
      expect(rule.country).toBeDefined();
      expect(rule.maxDigits).toBeDefined();
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(rule.errorMessage).toBeDefined();
    });
  });

  it('starts with India as the default rule', () => {
    expect(COUNTRY_PHONE_RULES[0].code).toBe('+91');
    expect(COUNTRY_PHONE_RULES[0].country).toBe('IN');
  });
});

describe('getCountryPhoneRule', () => {
  it('returns India (+91) when code is undefined', () => {
    expect(getCountryPhoneRule()).toEqual(COUNTRY_PHONE_RULES[0]);
    expect(getCountryPhoneRule().code).toBe('+91');
  });

  it('returns India (+91) when code is null', () => {
    expect(getCountryPhoneRule(undefined).code).toBe('+91');
  });

  it('returns the matching rule for a valid country code', () => {
    expect(getCountryPhoneRule('+1').country).toBe('US');
    expect(getCountryPhoneRule('+44').country).toBe('GB');
    expect(getCountryPhoneRule('+971').country).toBe('AE');
    expect(getCountryPhoneRule('+966').country).toBe('SA');
    expect(getCountryPhoneRule('+65').country).toBe('SG');
    expect(getCountryPhoneRule('+61').country).toBe('AU');
    expect(getCountryPhoneRule('+49').country).toBe('DE');
  });

  it('returns India (+91) as fallback for unknown country code', () => {
    expect(getCountryPhoneRule('+999').code).toBe('+91');
    expect(getCountryPhoneRule('').code).toBe('+91');
  });
});

describe('validatePhoneNumber', () => {
  it('returns null for null, undefined, or empty input', () => {
    expect(validatePhoneNumber(null)).toBeNull();
    expect(validatePhoneNumber(undefined)).toBeNull();
    expect(validatePhoneNumber('')).toBeNull();
    expect(validatePhoneNumber('   ')).toBeNull();
  });

  it('returns "Phone number required" for empty digits after stripping', () => {
    expect(validatePhoneNumber('abc-def')).toBe('Phone number required');
    expect(validatePhoneNumber('---')).toBe('Phone number required');
  });

  describe('India (+91) validation', () => {
    it('accepts valid Indian phone numbers', () => {
      expect(validatePhoneNumber('9876543210')).toBeNull();
      expect(validatePhoneNumber('8765432109')).toBeNull();
      expect(validatePhoneNumber('7654321098')).toBeNull();
      expect(validatePhoneNumber('6543210987')).toBeNull();
    });

    it('rejects Indian numbers not starting with 6-9', () => {
      expect(validatePhoneNumber('5876543210')).toBe(
        'Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9'
      );
      expect(validatePhoneNumber('1234567890')).toBe(
        'Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9'
      );
    });

    it('rejects Indian numbers with wrong digit count', () => {
      expect(validatePhoneNumber('987654321')).toBe(
        'Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9'
      );
      expect(validatePhoneNumber('98765432101')).toBe(
        'Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9'
      );
    });

    it('accepts +91 prefix and strips it', () => {
      expect(validatePhoneNumber('+91 9876543210')).toBeNull();
      expect(validatePhoneNumber('+919876543210')).toBeNull();
    });

    it('defaults to India when no country code is detected', () => {
      expect(validatePhoneNumber('9876543210')).toBeNull();
    });
  });

  describe('US/Canada (+1) validation', () => {
    it('accepts valid US phone numbers when prefixed', () => {
      expect(validatePhoneNumber('+1 2025551234')).toBeNull();
      expect(validatePhoneNumber('+12025551234')).toBeNull();
    });

    it('rejects US numbers starting with 0 or 1', () => {
      expect(validatePhoneNumber('+1 1025551234')).toBe(
        'Must be a valid 10-digit US/Canada phone number'
      );
      expect(validatePhoneNumber('+1 0125551234')).toBe(
        'Must be a valid 10-digit US/Canada phone number'
      );
    });

    it('uses forcedCode to interpret as US when no prefix', () => {
      expect(validatePhoneNumber('2025551234', '+1')).toBeNull();
      expect(validatePhoneNumber('1025551234', '+1')).toBe(
        'Must be a valid 10-digit US/Canada phone number'
      );
    });
  });

  describe('UK (+44) validation', () => {
    it('accepts valid UK phone numbers when prefixed', () => {
      expect(validatePhoneNumber('+44 7123456789')).toBeNull();
      expect(validatePhoneNumber('+44 10234567890')).toBeNull();
    });

    it('rejects UK numbers with wrong format', () => {
      expect(validatePhoneNumber('+44 812345678')).toBe(
        'Must be a valid UK phone number (10-11 digits)'
      );
    });
  });

  describe('UAE (+971) validation', () => {
    it('accepts valid UAE phone numbers when prefixed', () => {
      expect(validatePhoneNumber('+971 501234567')).toBeNull();
      expect(validatePhoneNumber('+971 521234567')).toBeNull();
    });

    it('rejects UAE numbers not starting with 50/52/54/55/58', () => {
      expect(validatePhoneNumber('+971 601234567')).toBe(
        'Must be a valid 9-digit UAE mobile number'
      );
    });
  });

  describe('Saudi Arabia (+966) validation', () => {
    it('accepts valid Saudi phone numbers when prefixed', () => {
      expect(validatePhoneNumber('+966 512345678')).toBeNull();
      expect(validatePhoneNumber('+966 591234567')).toBeNull();
    });

    it('rejects numbers not starting with 5', () => {
      expect(validatePhoneNumber('+966 612345678')).toBe(
        'Must be a valid 9-digit Saudi mobile number'
      );
    });
  });

  describe('with forcedCode', () => {
    it('applies the forced country rule regardless of prefix', () => {
      expect(validatePhoneNumber('+1 2025551234', '+44')).toBeNull();
      expect(validatePhoneNumber('7123456789', '+44')).toBeNull();
    });

    it('strips the country code prefix if forcedCode matches', () => {
      expect(validatePhoneNumber('+91 9876543210', '+91')).toBeNull();
    });
  });

  describe('formatting tolerance', () => {
    it('accepts numbers with spaces and dashes', () => {
      expect(validatePhoneNumber('98 765 432 10')).toBeNull();
      expect(validatePhoneNumber('9876-543-210')).toBeNull();
      expect(validatePhoneNumber('(987) 654-3210')).toBeNull();
    });

    it('trims whitespace from input', () => {
      expect(validatePhoneNumber('  9876543210  ')).toBeNull();
    });
  });
});

describe('validateFieldValue', () => {
  describe('required validation', () => {
    it('returns "Required" for null when isRequired is true', () => {
      const field: ValidatableField = { type: 'text', isRequired: true };
      expect(validateFieldValue(field, null)).toBe('Required');
      expect(validateFieldValue(field, undefined)).toBe('Required');
    });

    it('returns "Required" for empty string when isRequired is true', () => {
      const field: ValidatableField = { type: 'text', isRequired: true };
      expect(validateFieldValue(field, '')).toBe('Required');
    });

    it('returns "Required" for empty array when isRequired is true', () => {
      const field: ValidatableField = { type: 'multiselect', isRequired: true };
      expect(validateFieldValue(field, [])).toBe('Required');
    });

    it('returns null for required=false even if value is empty', () => {
      const field: ValidatableField = { type: 'text', isRequired: false };
      expect(validateFieldValue(field, '')).toBeNull();
      expect(validateFieldValue(field, null)).toBeNull();
    });

    it('allows boolean false to pass even if required', () => {
      const field: ValidatableField = { type: 'checkbox', isRequired: true };
      expect(validateFieldValue(field, false)).toBeNull();
    });
  });

  describe('phone field validation', () => {
    it('validates phone type fields with validatePhoneNumber', () => {
      const field: ValidatableField = { type: 'phone', isRequired: false };
      expect(validateFieldValue(field, '9876543210')).toBeNull();
      expect(validateFieldValue(field, '1234567890')).toBe(
        'Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9'
      );
    });

    it('returns null for empty phone field when not required', () => {
      const field: ValidatableField = { type: 'phone', isRequired: false };
      expect(validateFieldValue(field, '')).toBeNull();
      expect(validateFieldValue(field, null)).toBeNull();
    });

    it('requires phone when isRequired=true', () => {
      const field: ValidatableField = { type: 'phone', isRequired: true };
      expect(validateFieldValue(field, '')).toBe('Required');
    });
  });

  describe('numeric min/max validation', () => {
    it('validates min constraint on numbers', () => {
      const field: ValidatableField = {
        type: 'number',
        validation: { min: 10 },
      };
      expect(validateFieldValue(field, 10)).toBeNull();
      expect(validateFieldValue(field, 15)).toBeNull();
      expect(validateFieldValue(field, 9)).toBe('Must be at least 10');
    });

    it('validates max constraint on numbers', () => {
      const field: ValidatableField = {
        type: 'number',
        validation: { max: 100 },
      };
      expect(validateFieldValue(field, 100)).toBeNull();
      expect(validateFieldValue(field, 50)).toBeNull();
      expect(validateFieldValue(field, 101)).toBe('Must not exceed 100');
    });

    it('uses custom errorMessage for min/max violations', () => {
      const field: ValidatableField = {
        type: 'number',
        validation: { min: 10, errorMessage: 'Too low' },
      };
      expect(validateFieldValue(field, 9)).toBe('Too low');
    });

    it('ignores min/max on non-numeric types', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: { min: 10 },
      };
      expect(validateFieldValue(field, 'abc')).toBeNull();
    });

    it('handles numeric type string', () => {
      const field: ValidatableField = {
        type: 'numeric',
        validation: { min: 5, max: 20 },
      };
      expect(validateFieldValue(field, 10)).toBeNull();
      expect(validateFieldValue(field, 4)).toBe('Must be at least 5');
      expect(validateFieldValue(field, 21)).toBe('Must not exceed 20');
    });

    it('ignores NaN values for numeric validation', () => {
      const field: ValidatableField = {
        type: 'number',
        validation: { min: 10 },
      };
      expect(validateFieldValue(field, 'not-a-number')).toBeNull();
    });
  });

  describe('string length validation', () => {
    it('validates minLength constraint on strings', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: { minLength: 3 },
      };
      expect(validateFieldValue(field, 'abc')).toBeNull();
      expect(validateFieldValue(field, 'ab')).toBe('Must be at least 3 characters');
    });

    it('validates maxLength constraint on strings', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: { maxLength: 5 },
      };
      expect(validateFieldValue(field, 'abcde')).toBeNull();
      expect(validateFieldValue(field, 'abcdef')).toBe('Must not exceed 5 characters');
    });

    it('applies to textarea type', () => {
      const field: ValidatableField = {
        type: 'textarea',
        validation: { minLength: 10 },
      };
      expect(validateFieldValue(field, 'short')).toBe('Must be at least 10 characters');
    });

    it('applies to phone type', () => {
      const field: ValidatableField = {
        type: 'phone',
        validation: { minLength: 5 },
      };
      // Phone is validated by validatePhoneNumber before length check
      expect(validateFieldValue(field, '987')).toBe(
        'Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9'
      );
    });

    it('uses custom errorMessage for length violations', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: { minLength: 5, errorMessage: 'Too short' },
      };
      expect(validateFieldValue(field, 'hi')).toBe('Too short');
    });
  });

  describe('pattern validation', () => {
    it('validates regex pattern on strings', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: { pattern: '^[a-z]+$' },
      };
      expect(validateFieldValue(field, 'abc')).toBeNull();
      expect(validateFieldValue(field, 'ABC')).toBe('Invalid format');
      expect(validateFieldValue(field, 'abc123')).toBe('Invalid format');
    });

    it('uses custom errorMessage for pattern violations', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: { pattern: '^[0-9]+$', errorMessage: 'Only numbers allowed' },
      };
      expect(validateFieldValue(field, 'abc')).toBe('Only numbers allowed');
    });

    it('skips invalid regex patterns silently', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: { pattern: '[invalid(' },
      };
      expect(validateFieldValue(field, 'anything')).toBeNull();
    });

    it('applies to email and phone types', () => {
      const field: ValidatableField = {
        type: 'email',
        validation: { pattern: '@example.com$' },
      };
      expect(validateFieldValue(field, 'user@example.com')).toBeNull();
      expect(validateFieldValue(field, 'user@other.com')).toBe('Invalid format');
    });
  });

  describe('multiselect min/max validation', () => {
    it('validates min picks for multiselect arrays', () => {
      const field: ValidatableField = {
        type: 'multiselect',
        validation: { min: 2 },
      };
      expect(validateFieldValue(field, ['a', 'b'])).toBeNull();
      expect(validateFieldValue(field, ['a'])).toBe('Pick at least 2');
      // GAP (frozen): an EMPTY multiselect bypasses the min check — isEmpty([])
      // short-circuits to null at validate.ts:164 before min runs, so a
      // min-required multiselect with 0 picks passes validation.
      expect(validateFieldValue(field, [])).toBeNull();
    });

    it('validates max picks for multiselect arrays', () => {
      const field: ValidatableField = {
        type: 'multiselect',
        validation: { max: 3 },
      };
      expect(validateFieldValue(field, ['a', 'b', 'c'])).toBeNull();
      expect(validateFieldValue(field, ['a', 'b', 'c', 'd'])).toBe('Pick at most 3');
    });

    it('applies to multi_button_select type', () => {
      const field: ValidatableField = {
        type: 'multi_button_select',
        validation: { min: 1, max: 2 },
      };
      expect(validateFieldValue(field, ['opt1'])).toBeNull();
      // GAP (frozen): empty bypasses min — validate.ts:164 short-circuit.
      expect(validateFieldValue(field, [])).toBeNull();
      expect(validateFieldValue(field, ['a', 'b', 'c'])).toBe('Pick at most 2');
    });

    it('uses custom errorMessage for multiselect violations', () => {
      const field: ValidatableField = {
        type: 'multiselect',
        validation: { min: 2, errorMessage: 'Select at least 2 items' },
      };
      expect(validateFieldValue(field, ['a'])).toBe('Select at least 2 items');
    });
  });

  describe('array-based validation rules', () => {
    it('processes array of validation rules in order', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: [
          { type: 'minLength', value: 5, message: 'Too short' },
          { type: 'maxLength', value: 10, message: 'Too long' },
        ],
      };
      expect(validateFieldValue(field, 'hi')).toBe('Too short');
      expect(validateFieldValue(field, 'hello')).toBeNull();
      expect(validateFieldValue(field, 'this is way too long')).toBe('Too long');
    });

    it('returns first failing rule message', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: [
          { type: 'minLength', value: 3 },
          { type: 'maxLength', value: 5 },
        ],
      };
      expect(validateFieldValue(field, 'hi')).toBe('Invalid value');
    });

    it('applies rules in array order until first failure', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: [
          { type: 'minLength', value: 2 },
          { type: 'maxLength', value: 5 },
        ],
      };
      expect(validateFieldValue(field, 'a')).toBe('Invalid value');
      expect(validateFieldValue(field, 'ab')).toBeNull();
      expect(validateFieldValue(field, 'abcdef')).toBe('Invalid value');
    });

    it('GAP: array-rule {type:required} is NOT enforced (dead code) unless field.isRequired is set', () => {
      // validate.ts:164 returns null for empty values BEFORE the array loop,
      // so the array-level required rule at :181 is unreachable — an empty
      // value passes even though a required rule was declared. Frozen as-is;
      // this documents the gap (should arguably return 'This is required').
      const field: ValidatableField = {
        type: 'text',
        validation: [{ type: 'required', message: 'This is required' }],
      };
      expect(validateFieldValue(field, '')).toBeNull();   // gap: not enforced
      expect(validateFieldValue(field, 'ok')).toBeNull();
    });

    it('handles phone type in array rules', () => {
      const field: ValidatableField = {
        type: 'phone',
        validation: [{ type: 'phone', message: 'Bad phone' }],
      };
      expect(validateFieldValue(field, '9876543210')).toBeNull();
      // Field-level phone (validate.ts:166) runs first, so the array rule's
      // custom 'Bad phone' message is shadowed by the built-in India message.
      expect(validateFieldValue(field, '1234567890')).toBe('Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9');
    });

    it('handles min/max in array rules for numbers', () => {
      const field: ValidatableField = {
        type: 'number',
        validation: [
          { type: 'min', value: 10, message: 'Below min' },
          { type: 'max', value: 100, message: 'Above max' },
        ],
      };
      expect(validateFieldValue(field, 9)).toBe('Below min');
      expect(validateFieldValue(field, 50)).toBeNull();
      expect(validateFieldValue(field, 101)).toBe('Above max');
    });

    it('handles minLength/maxLength in array rules', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: [
          { type: 'minLength', value: 3, message: 'Short' },
          { type: 'maxLength', value: 5, message: 'Long' },
        ],
      };
      expect(validateFieldValue(field, 'ab')).toBe('Short');
      expect(validateFieldValue(field, 'hello')).toBeNull();
      expect(validateFieldValue(field, 'verylongtext')).toBe('Long');
    });

    it('handles pattern in array rules', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: [{ type: 'pattern', value: '^[0-9]+$', message: 'Numbers only' }],
      };
      expect(validateFieldValue(field, '12345')).toBeNull();
      expect(validateFieldValue(field, 'abc')).toBe('Numbers only');
    });

    it('uses default message when no message/errorMessage provided', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: [{ type: 'minLength', value: 5 }],
      };
      expect(validateFieldValue(field, 'hi')).toBe('Invalid value');
    });

    it('prefers message over errorMessage', () => {
      const field: ValidatableField = {
        type: 'text',
        validation: [
          { type: 'minLength', value: 5, message: 'From message', errorMessage: 'From errorMessage' },
        ],
      };
      expect(validateFieldValue(field, 'hi')).toBe('From message');
    });
  });

  describe('no validation provided', () => {
    it('returns null when validation is null', () => {
      const field: ValidatableField = { type: 'text', validation: null };
      expect(validateFieldValue(field, 'anything')).toBeNull();
    });

    it('returns null when validation is undefined', () => {
      const field: ValidatableField = { type: 'text' };
      expect(validateFieldValue(field, 'anything')).toBeNull();
    });
  });
});

describe('isNumericType', () => {
  it('returns true for "number" type', () => {
    expect(isNumericType('number')).toBe(true);
  });

  it('returns true for "numeric" type', () => {
    expect(isNumericType('numeric')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(isNumericType('text')).toBe(false);
    expect(isNumericType('phone')).toBe(false);
    expect(isNumericType('email')).toBe(false);
    expect(isNumericType('textarea')).toBe(false);
    expect(isNumericType('select')).toBe(false);
    expect(isNumericType('')).toBe(false);
  });
});

describe('isMultiSelectType', () => {
  it('returns true for "multiselect" type', () => {
    expect(isMultiSelectType('multiselect')).toBe(true);
  });

  it('returns true for "multi_button_select" type', () => {
    expect(isMultiSelectType('multi_button_select')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(isMultiSelectType('text')).toBe(false);
    expect(isMultiSelectType('select')).toBe(false);
    expect(isMultiSelectType('number')).toBe(false);
    expect(isMultiSelectType('checkbox')).toBe(false);
    expect(isMultiSelectType('')).toBe(false);
  });
});

describe('supportsLengthValidation', () => {
  it('returns true for "text" type', () => {
    expect(supportsLengthValidation('text')).toBe(true);
  });

  it('returns true for "textarea" type', () => {
    expect(supportsLengthValidation('textarea')).toBe(true);
  });

  it('returns true for "phone" type', () => {
    expect(supportsLengthValidation('phone')).toBe(true);
  });

  it('returns true for "email" type', () => {
    expect(supportsLengthValidation('email')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(supportsLengthValidation('number')).toBe(false);
    expect(supportsLengthValidation('select')).toBe(false);
    expect(supportsLengthValidation('checkbox')).toBe(false);
    expect(supportsLengthValidation('multiselect')).toBe(false);
    expect(supportsLengthValidation('')).toBe(false);
  });
});

describe('supportsPatternValidation', () => {
  it('returns true for "text" type', () => {
    expect(supportsPatternValidation('text')).toBe(true);
  });

  it('returns true for "phone" type', () => {
    expect(supportsPatternValidation('phone')).toBe(true);
  });

  it('returns true for "email" type', () => {
    expect(supportsPatternValidation('email')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(supportsPatternValidation('textarea')).toBe(false);
    expect(supportsPatternValidation('number')).toBe(false);
    expect(supportsPatternValidation('select')).toBe(false);
    expect(supportsPatternValidation('checkbox')).toBe(false);
    expect(supportsPatternValidation('multiselect')).toBe(false);
    expect(supportsPatternValidation('')).toBe(false);
  });
});
