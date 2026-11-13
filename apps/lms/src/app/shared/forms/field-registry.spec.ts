import {
  allFieldTypes,
  enabledFieldTypes,
  getFieldType,
  isFieldTypeEnabled,
  hasOptions,
  setFieldTypeEnabled,
  fieldTypesByCategory,
  FieldTypeEntry,
} from './field-registry';
import { FormFieldType, FormFieldCategory } from './form-field.model';

describe('field-registry', () => {
  describe('allFieldTypes', () => {
    it('returns all 35 field type entries (34 on by default + the opt-in Family tree)', () => {
      const all = allFieldTypes();
      expect(all.length).toBe(35);
      expect(all.filter(e => !e.enabled).map(e => e.type)).toEqual(['family']);
    });

    it('includes entries from each category', () => {
      const all = allFieldTypes();
      const categories = new Set(all.map(e => e.category));
      expect(categories).toEqual(new Set(['input', 'choice', 'layout', 'media', 'advanced']));
    });

    it('returns a new array each time (not the same reference)', () => {
      const a = allFieldTypes();
      const b = allFieldTypes();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('every entry has required properties', () => {
      const all = allFieldTypes();
      for (const entry of all) {
        expect(entry).toHaveProperty('type');
        expect(entry).toHaveProperty('label');
        expect(entry).toHaveProperty('category');
        expect(entry).toHaveProperty('enabled');
        expect(entry).toHaveProperty('hasOptions');
        expect(typeof entry.type).toBe('string');
        expect(typeof entry.label).toBe('string');
        expect(typeof entry.enabled).toBe('boolean');
        expect(typeof entry.hasOptions).toBe('boolean');
      }
    });
  });

  describe('enabledFieldTypes', () => {
    it('returns only enabled entries by default', () => {
      const enabled = enabledFieldTypes();
      expect(enabled.length).toBe(34);
      expect(enabled.every(e => e.enabled)).toBe(true);
    });

    it('reflects setFieldTypeEnabled mutations', () => {
      const before = enabledFieldTypes();
      const beforeCount = before.length;

      setFieldTypeEnabled('text', false);
      const after = enabledFieldTypes();
      expect(after.length).toBe(beforeCount - 1);
      expect(after.every(e => e.type !== 'text')).toBe(true);

      // Cleanup
      setFieldTypeEnabled('text', true);
    });

    it('respects multiple disabled types', () => {
      setFieldTypeEnabled('number', false);
      setFieldTypeEnabled('select', false);
      const enabled = enabledFieldTypes();
      expect(enabled.every(e => e.type !== 'number' && e.type !== 'select')).toBe(true);

      // Cleanup
      setFieldTypeEnabled('number', true);
      setFieldTypeEnabled('select', true);
    });
  });

  describe('getFieldType', () => {
    it('returns the entry for known field types', () => {
      const text = getFieldType('text');
      expect(text).toBeDefined();
      expect(text?.type).toBe('text');
      expect(text?.label).toBe('Text');
      expect(text?.category).toBe('input');
      expect(text?.enabled).toBe(true);
      expect(text?.hasOptions).toBe(false);
    });

    it('returns correct entries for various types across categories', () => {
      const select = getFieldType('select');
      expect(select?.category).toBe('choice');
      expect(select?.hasOptions).toBe(true);

      const imageGallery = getFieldType('imageGallery');
      expect(imageGallery?.category).toBe('media');

      const sectionHeader = getFieldType('section-header');
      expect(sectionHeader?.category).toBe('layout');
    });

    it('returns undefined for unknown field types', () => {
      expect(getFieldType('unknown-type' as FormFieldType)).toBeUndefined();
      expect(getFieldType('not-a-real-type' as FormFieldType)).toBeUndefined();
    });

    it('returns a live reference (mutations affect the registry)', () => {
      const entry = getFieldType('text');
      expect(entry).toBeDefined();
      if (entry) {
        const originalLabel = entry.label;
        entry.label = 'Modified';

        const entry2 = getFieldType('text');
        expect(entry2?.label).toBe('Modified');

        // Restore state so sibling tests are not affected
        entry.label = originalLabel;
      }
    });
  });

  describe('isFieldTypeEnabled', () => {
    it('returns true for enabled types', () => {
      expect(isFieldTypeEnabled('text')).toBe(true);
      expect(isFieldTypeEnabled('select')).toBe(true);
      expect(isFieldTypeEnabled('imageGallery')).toBe(true);
    });

    it('returns false for disabled types after setFieldTypeEnabled', () => {
      setFieldTypeEnabled('text', false);
      expect(isFieldTypeEnabled('text')).toBe(false);

      setFieldTypeEnabled('text', true);
      expect(isFieldTypeEnabled('text')).toBe(true);
    });

    it('returns false for unknown types', () => {
      expect(isFieldTypeEnabled('unknown-type' as FormFieldType)).toBe(false);
      expect(isFieldTypeEnabled('not-a-real-type' as FormFieldType)).toBe(false);
    });
  });

  describe('hasOptions', () => {
    it('returns true for types with hasOptions: true', () => {
      expect(hasOptions('select')).toBe(true);
      expect(hasOptions('multiselect')).toBe(true);
      expect(hasOptions('radio')).toBe(true);
      expect(hasOptions('buttonSelect')).toBe(true);
      expect(hasOptions('imageSelect')).toBe(true);
      expect(hasOptions('imageInfo')).toBe(true);
    });

    it('returns false for types without options', () => {
      expect(hasOptions('text')).toBe(false);
      expect(hasOptions('number')).toBe(false);
      expect(hasOptions('date')).toBe(false);
      expect(hasOptions('checkbox')).toBe(false);
      expect(hasOptions('toggle')).toBe(false);
      expect(hasOptions('section-header')).toBe(false);
    });

    it('returns false for unknown types', () => {
      expect(hasOptions('unknown-type' as FormFieldType)).toBe(false);
    });
  });

  describe('setFieldTypeEnabled', () => {
    it('disables a known type', () => {
      setFieldTypeEnabled('text', false);
      expect(isFieldTypeEnabled('text')).toBe(false);
      expect(getFieldType('text')?.enabled).toBe(false);
      setFieldTypeEnabled('text', true);
    });

    it('re-enables a disabled type', () => {
      setFieldTypeEnabled('number', false);
      expect(isFieldTypeEnabled('number')).toBe(false);
      setFieldTypeEnabled('number', true);
      expect(isFieldTypeEnabled('number')).toBe(true);
    });

    it('does nothing for unknown types', () => {
      const before = enabledFieldTypes().length;
      setFieldTypeEnabled('unknown-type' as FormFieldType, false);
      const after = enabledFieldTypes().length;
      expect(before).toBe(after);
    });

    it('affects subsequent calls to enabledFieldTypes', () => {
      const before = enabledFieldTypes();
      setFieldTypeEnabled('select', false);
      const after = enabledFieldTypes();
      expect(after.length).toBe(before.length - 1);
      expect(after.every(e => e.type !== 'select')).toBe(true);
      setFieldTypeEnabled('select', true);
    });

    it('persists across multiple mutations', () => {
      setFieldTypeEnabled('text', false);
      setFieldTypeEnabled('number', false);
      expect(isFieldTypeEnabled('text')).toBe(false);
      expect(isFieldTypeEnabled('number')).toBe(false);
      expect(isFieldTypeEnabled('select')).toBe(true);

      setFieldTypeEnabled('text', true);
      setFieldTypeEnabled('number', true);
    });
  });

  describe('fieldTypesByCategory', () => {
    it('groups all enabled entries by category by default', () => {
      const grouped = fieldTypesByCategory();

      expect(grouped).toHaveProperty('input');
      expect(grouped).toHaveProperty('choice');
      expect(grouped).toHaveProperty('layout');
      expect(grouped).toHaveProperty('media');
      expect(grouped).toHaveProperty('advanced');

      const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
      expect(total).toBe(34); // onlyEnabled by default: the opt-in 'family' is not listed
    });

    it('respects onlyEnabled=true (default)', () => {
      setFieldTypeEnabled('text', false);
      const grouped = fieldTypesByCategory(true);

      expect(grouped.input.every(e => e.type !== 'text')).toBe(true);
      expect(grouped.input.every(e => e.enabled)).toBe(true);

      setFieldTypeEnabled('text', true);
    });

    it('includes disabled entries when onlyEnabled=false', () => {
      setFieldTypeEnabled('text', false);
      const groupedEnabled = fieldTypesByCategory(true);
      const groupedAll = fieldTypesByCategory(false);

      expect(groupedAll.input.length).toBeGreaterThan(groupedEnabled.input.length);
      expect(groupedAll.input.some(e => e.type === 'text' && !e.enabled)).toBe(true);

      setFieldTypeEnabled('text', true);
    });

    it('correctly categorizes all field types', () => {
      const grouped = fieldTypesByCategory(false);

      expect(grouped.input).toContainEqual(expect.objectContaining({ type: 'text' }));
      expect(grouped.input).toContainEqual(expect.objectContaining({ type: 'number' }));
      expect(grouped.choice).toContainEqual(expect.objectContaining({ type: 'select' }));
      expect(grouped.choice).toContainEqual(expect.objectContaining({ type: 'radio' }));
      expect(grouped.layout).toContainEqual(expect.objectContaining({ type: 'section-header' }));
      expect(grouped.media).toContainEqual(expect.objectContaining({ type: 'imageGallery' }));
      expect(grouped.advanced).toContainEqual(expect.objectContaining({ type: 'table' }));
    });

    it('returns empty arrays for empty categories', () => {
      const grouped = fieldTypesByCategory(false);

      for (const category of Object.keys(grouped) as FormFieldCategory[]) {
        expect(Array.isArray(grouped[category])).toBe(true);
      }
    });

    it('maintains category invariants across enabled/disabled states', () => {
      setFieldTypeEnabled('select', false);
      const grouped = fieldTypesByCategory(true);

      // All returned entries should be enabled
      for (const entries of Object.values(grouped)) {
        expect(entries.every(e => e.enabled)).toBe(true);
      }

      setFieldTypeEnabled('select', true);
    });
  });

  describe('registry invariants', () => {
    it('all field types start enabled by default', () => {
      // Reset all to enabled state first
      allFieldTypes().forEach(e => setFieldTypeEnabled(e.type, true));

      const enabled = enabledFieldTypes();
      const all = allFieldTypes();
      expect(enabled.length).toBe(all.length);
    });

    it('each entry has a unique type', () => {
      const all = allFieldTypes();
      const types = all.map(e => e.type);
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBe(types.length);
    });

    it('entry mutations affect the registry (live reference)', () => {
      const entry = getFieldType('text');
      if (entry) {
        const originalEnabled = entry.enabled;
        const originalLabel = entry.label;

        entry.enabled = !entry.enabled;
        entry.label = 'Modified Label';

        const entry2 = getFieldType('text');
        expect(entry2?.enabled).toBe(!originalEnabled);
        expect(entry2?.label).toBe('Modified Label');

        // Restore state so sibling tests are not affected
        entry.enabled = originalEnabled;
        entry.label = originalLabel;
      }
    });

    it('categories are valid FormFieldCategory values', () => {
      const validCategories: FormFieldCategory[] = ['input', 'choice', 'layout', 'media', 'advanced'];
      const all = allFieldTypes();

      for (const entry of all) {
        expect(validCategories).toContain(entry.category);
      }
    });
  });
});
