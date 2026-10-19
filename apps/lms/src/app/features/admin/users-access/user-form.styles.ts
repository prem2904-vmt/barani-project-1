/**
 * Shared styles for the Users & Access single-record editors (create user,
 * edit user, role editor) — PF-PATTERN "Editors": pf-card sections in the
 * band body, kit fields, slate switches for roles / permissions. Local to
 * this feature (the pf-kit owns the global pieces).
 */
/** Title (honorific) options — pf-select, never a native select. */
export const TITLE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Dr.', label: 'Dr.' },
  { value: 'Mr.', label: 'Mr.' },
  { value: 'Mrs.', label: 'Mrs.' },
  { value: 'Ms.', label: 'Ms.' },
];
