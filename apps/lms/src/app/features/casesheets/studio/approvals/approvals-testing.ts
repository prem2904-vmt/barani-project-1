/** Test fixtures for the case-sheet approvals specs (wire JSON exactly as the backend contract sends it). */
export const WIRE_PROPOSAL = {
  id: 'p1', kind: 'edit', status: 'pending', formId: 'f1', catalogKey: 'ent', title: 'ENT case sheet', departmentKey: 'ent',
  summary: "Added the question 'Cough'\nChanged what 'Fever' says\n", source: 'connector', clientId: 'c-1', appName: 'Claude',
  proposedBy: 'u1', proposedByName: 'Priya Raman', createdAt: '2026-11-11T05:00:00Z', updatedAt: '2026-11-11T05:10:00Z',
  decidedAt: null, decidedBy: null, decidedByName: null, note: null, error: null, appliedFormId: null, appliedVersionId: null,
  basisVersionId: 'v3', sharedMaster: false,
  detail: {
    current: { versionId: 'v3', versionNo: 3, state: 'published', definition: { title: 'ENT', pages: [{ key: 'h', title: 'History', fields: [{ key: 'fever', kind: 'yesno', label: 'Fever' }] }] } },
    proposed: { title: 'ENT', pages: [{ key: 'h', title: 'History', fields: [{ key: 'fever', kind: 'yesno', label: 'Fever' }, { key: 'cough', kind: 'yesno', label: 'Cough' }] }] },
    changeSummary: { fieldsAdded: 1, total: 2, identical: false, headline: '1 field added, 1 sentence changed' },
    changes: [
      { type: 'field_added', pageKey: 'h', pageTitle: 'History', fieldKey: 'cough', fieldLabel: 'Cough', what: null, before: null, after: null, words: "Added the question 'Cough'" },
      { type: 'sentence_changed', pageKey: 'h', pageTitle: 'History', fieldKey: 'fever', fieldLabel: 'Fever', what: 'sentence', before: 'Has fever.', after: 'Fever present.', words: "Changed what 'Fever' says" },
      { type: 'setting_changed', pageKey: null, pageTitle: null, fieldKey: null, fieldLabel: null, what: null, before: null, after: null, words: 'Renamed the case sheet' },
    ],
    problems: [{ severity: 'warning', path: 'x', pageKey: null, pageTitle: null, fieldKey: null, fieldLabel: null, where: '', message: 'm', summary: 'Cough has no sentence yet' }],
    checks: { summary: { total: 2, passed: 1, failed: 1, coverage: { rules: 2, tested: 2 } }, checks: [
      { id: 'k1', title: 'Fever shows', source: 'auto', given: [], expect: [], result: { pass: true, failures: [] }, ranAt: null },
      { id: 'k2', title: 'Cough opens Duration', source: 'cortex', given: [], expect: [], result: { pass: false, failures: ["'Duration' did not show"] }, ranAt: null },
    ] },
    canApprove: true,
  },
};

export const WIRE_OFFER = {
  id: 'o1', catalogKey: 'general', formId: 'f-own', title: 'General medicine', masterVersionId: 'mv5', masterVersionNo: 5, masterPublishedAt: '2026-11-10T09:00:00Z',
  yourBasisVersionNo: 3, status: 'pending', createdAt: '2026-11-10T09:00:00Z', decidedAt: null, decidedByName: null, youHaveADraft: false,
  changeSummary: { headline: '1 field added' },
  changes: [{ type: 'field_added', pageKey: 'h', pageTitle: 'History', fieldKey: 'smoke', fieldLabel: 'Smoking', what: null, before: null, after: 'Smoking', words: "Added the question 'Smoking'" }],
};
