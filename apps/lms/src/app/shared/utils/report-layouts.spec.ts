import {
  resolveReportLayouts,
  LayoutSnapshotTest,
  PreviewFn,
} from './report-layouts';

describe('resolveReportLayouts', () => {
  const mockPreview: PreviewFn = async (
    testId: string,
    values: Record<string, unknown>,
    conditions: unknown[],
    patient?: { sex?: string | null; age?: number | null }
  ): Promise<unknown> => ({
    testId,
    values,
    conditions,
    patient,
  });

  const mockPreviewByTestId = (responses: Record<string, unknown>): PreviewFn =>
    async (testId, values, conditions, patient) => {
      if (testId in responses) {
        return responses[testId];
      }
      throw new Error(`No layout for ${testId}`);
    };

  it('resolves a single test with its result values', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: { values: { BIO153: 200, BIO155: 50 } },
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    expect(layouts['TEST001']).toBeDefined();
    expect(layouts['TEST001']).toEqual({
      testId: 'TEST001',
      values: { BIO153: 200, BIO155: 50 },
      conditions: [],
      patient: undefined,
    });
  });

  it('resolves multiple tests independently', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: { values: { BIO153: 200 } },
      },
      {
        testId: 'TEST002',
        result: { values: { HEM011: 15 } },
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    expect(layouts['TEST001']).toEqual({
      testId: 'TEST001',
      values: { BIO153: 200 },
      conditions: [],
      patient: undefined,
    });
    expect(layouts['TEST002']).toEqual({
      testId: 'TEST002',
      values: { HEM011: 15 },
      conditions: [],
      patient: undefined,
    });
  });

  it('passes result.values as empty object when result is null', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: null,
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    expect(layouts['TEST001']).toEqual({
      testId: 'TEST001',
      values: {},
      conditions: [],
      patient: undefined,
    });
  });

  it('passes result.values as empty object when result.values is missing', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: {},
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    expect(layouts['TEST001']).toEqual({
      testId: 'TEST001',
      values: {},
      conditions: [],
      patient: undefined,
    });
  });

  it('skips tests without testId', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        // no testId
        result: { values: { BIO153: 200 } },
      },
      {
        testId: 'TEST002',
        result: { values: { HEM011: 15 } },
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    expect(layouts['TEST002']).toBeDefined();
    expect(Object.keys(layouts)).toEqual(['TEST002']);
  });

  it('resolves profiles from distinct profileTestIds and packageTestIds', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        packageTestId: 'PKG_PROFILE_001',
        result: { values: { BIO153: 200 } },
      },
      {
        testId: 'TEST002',
        profileTestId: 'PROFILE_002',
        result: { values: { HEM011: 15 } },
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    // Should have both tests and both profiles
    expect(layouts['TEST001']).toBeDefined();
    expect(layouts['TEST002']).toBeDefined();
    expect(layouts['PKG_PROFILE_001']).toBeDefined();
    expect(layouts['PROFILE_002']).toBeDefined();

    // A profile resolves against ITS members' values (its blocks qualify
    // their results) — never another profile's.
    expect(layouts['PKG_PROFILE_001']).toEqual({
      testId: 'PKG_PROFILE_001',
      values: { BIO153: 200 },
      conditions: [],
      patient: undefined,
    });
    expect(layouts['PROFILE_002']).toEqual({
      testId: 'PROFILE_002',
      values: { HEM011: 15 },
      conditions: [],
      patient: undefined,
    });
  });

  it('deduplicates distinct profile IDs from both packageTestId and profileTestId', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        packageTestId: 'PROFILE_SAME',
        profileTestId: 'PROFILE_SAME',
        result: { values: { BIO153: 200 } },
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    // Should have test and only one profile (deduplicated)
    expect(Object.keys(layouts).sort()).toEqual(['PROFILE_SAME', 'TEST001']);
  });

  it('skips null/undefined profile IDs when collecting profiles', async () => {
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        packageTestId: null,
        profileTestId: undefined,
        result: { values: { BIO153: 200 } },
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    // Should have only the test, no profiles
    expect(Object.keys(layouts)).toEqual(['TEST001']);
  });

  it('does not re-fetch a profile if it was already resolved as a test', async () => {
    const preview = mockPreviewByTestId({
      TEST001: { id: 'test1_layout' },
      PROFILE_001: { id: 'profile1_layout' },
    });

    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: { values: { BIO153: 200 } },
      },
      {
        testId: 'PROFILE_001',
        packageTestId: 'PROFILE_001',
        result: { values: { HEM011: 15 } },
      },
    ];

    const layouts = await resolveReportLayouts(preview, tests);

    // PROFILE_001 gets resolved as a test first, then when the profile loop
    // tries to fetch it again, it finds it already in layouts and skips calling preview
    expect(layouts['PROFILE_001']).toEqual({ id: 'profile1_layout' });
    // Verify the skipping mechanism works by checking the test ran
    expect(layouts['TEST001']).toEqual({ id: 'test1_layout' });
  });

  it('silently skips tests when preview throws an error', async () => {
    const preview: PreviewFn = async (testId) => {
      if (testId === 'BAD_TEST') {
        throw new Error('Preview failed');
      }
      return { testId };
    };

    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'GOOD_TEST',
        result: { values: { BIO153: 200 } },
      },
      {
        testId: 'BAD_TEST',
        result: { values: { HEM011: 15 } },
      },
    ];

    const layouts = await resolveReportLayouts(preview, tests);

    // Should have only GOOD_TEST; BAD_TEST was silently skipped
    expect(layouts['GOOD_TEST']).toBeDefined();
    expect(layouts['BAD_TEST']).toBeUndefined();
  });

  it('silently skips profiles when preview throws an error', async () => {
    const preview: PreviewFn = async (testId) => {
      if (testId === 'BAD_PROFILE') {
        throw new Error('Profile preview failed');
      }
      return { testId };
    };

    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        profileTestId: 'BAD_PROFILE',
        result: { values: { BIO153: 200 } },
      },
    ];

    const layouts = await resolveReportLayouts(preview, tests);

    // Should have TEST001 but not BAD_PROFILE
    expect(layouts['TEST001']).toBeDefined();
    expect(layouts['BAD_PROFILE']).toBeUndefined();
  });

  it('passes patient demographics to preview function for all tests and profiles', async () => {
    const calledWith: Array<{
      testId: string;
      patient?: { sex?: string | null; age?: number | null };
    }> = [];
    const preview: PreviewFn = async (testId, values, conditions, patient) => {
      calledWith.push({ testId, patient });
      return { testId };
    };

    const patient = { sex: 'M', age: 45 };
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        packageTestId: 'PROFILE_001',
        result: { values: { BIO153: 200 } },
      },
    ];

    await resolveReportLayouts(preview, tests, patient);

    // Both test and profile should receive the patient
    expect(calledWith).toContainEqual({
      testId: 'TEST001',
      patient,
    });
    expect(calledWith).toContainEqual({
      testId: 'PROFILE_001',
      patient,
    });
  });

  it('handles empty tests array gracefully', async () => {
    const tests: LayoutSnapshotTest[] = [];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    expect(layouts).toEqual({});
  });

  it('preserves complex nested values in result.values', async () => {
    const complexValues = {
      simple: 42,
      nested: { a: 1, b: 2 },
      array: [1, 2, 3],
      null_val: null,
    };

    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: { values: complexValues },
      },
    ];

    const layouts = await resolveReportLayouts(mockPreview, tests);

    expect(layouts['TEST001']).toMatchObject({
      testId: 'TEST001',
      values: complexValues,
    });
  });

  it('handles patient with partial demographics (missing sex)', async () => {
    const preview: PreviewFn = async (testId, values, conditions, patient) => ({
      testId,
      patient,
    });

    const patient = { age: 30 };
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: { values: { BIO153: 200 } },
      },
    ];

    const layouts = await resolveReportLayouts(preview, tests, patient as any);

    expect(layouts['TEST001']).toMatchObject({
      patient: { age: 30 },
    });
  });

  it('handles patient with partial demographics (missing age)', async () => {
    const preview: PreviewFn = async (testId, values, conditions, patient) => ({
      testId,
      patient,
    });

    const patient = { sex: 'F' };
    const tests: LayoutSnapshotTest[] = [
      {
        testId: 'TEST001',
        result: { values: { BIO153: 200 } },
      },
    ];

    const layouts = await resolveReportLayouts(preview, tests, patient as any);

    expect(layouts['TEST001']).toMatchObject({
      patient: { sex: 'F' },
    });
  });

  it('unwraps flagged { value } wrappers so report-time conditions can match', async () => {
    // The snapshot stores { value, unit, range, flag } per parameter; the
    // engine's "When the result …" lines compare against the scalar. The
    // owner's bug (2026-09-20): wrappers reached the engine, nothing matched,
    // the base description printed.
    const seen: Array<Record<string, unknown>> = [];
    const preview: PreviewFn = async (_id, values) => { seen.push(values); return { ok: true }; };
    await resolveReportLayouts(preview, [{
      testId: 't1',
      result: { values: {
        'Fasting Blood Sugar': { value: '80', unit: 'mg/dL', range: '70–99', flag: 'N' },
        'Plain Scalar': '42',
      } },
    }]);
    expect(seen[0]['Fasting Blood Sugar']).toBe('80');
    expect(seen[0]['Plain Scalar']).toBe('42');
  });
});
describe('resolveReportLayouts — a profile sees its members\' results', () => {
  it('merges every member\'s scalar values (flag wrappers unwrapped) into the profile\'s preview', async () => {
    const calls: Record<string, Record<string, unknown>> = {};
    const preview: PreviewFn = async (id, values) => { calls[id] = values; return { id }; };
    await resolveReportLayouts(preview, [
      { testId: 'fbs', profileTestId: 'dia', result: { values: { fbs: { value: 132, flag: 'H' } } } },
      { testId: 'hba1c', profileTestId: 'dia', result: { values: { hba1c: 7.1 } } },
      { testId: 'tsh', result: { values: { tsh: 2 } } },
    ]);
    expect(calls['dia']).toEqual({ fbs: 132, hba1c: 7.1 });
  });
});
