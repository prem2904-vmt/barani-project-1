import { ColDef, ICellRendererParams, RowClassParams } from 'ag-grid-community';
import { ORIGIN_ICON_PATHS } from '../../../../shared/utils/test-origin';
import { whenText } from '../shared/when';
import { DepartmentRow, FormRow } from '../data/studio-models';

/**
 * The case-sheet list is Test Master's screen with case sheets for tests (owner 2026-11-12): the same grid theme
 * (`admin/tests/tests/grid-theme.ts`), the same `pf-tm-*` look (its stylesheet is shared), the same Origin chip
 * (`pf-origin-badge`), the same row action (`pf-rowact`). This file is the pure part: filters, labels, columns.
 */

export type SheetStatus = 'published' | 'draft';
export type SheetStatusFilter = 'all' | SheetStatus;
export type SheetOriginFilter = 'all' | 'master' | 'copy' | 'local';

/** What the Origin column says (Test Master's chip wording for case sheets). */
export const ORIGIN_WORDS: Record<FormRow['origin'], { kind: 'master' | 'customised' | 'local'; label: string; hint: string }> = {
  master: { kind: 'master', label: 'Master', hint: "Read from Prefrontal's master case sheet. Edit makes your lab's own copy." },
  override: { kind: 'customised', label: 'Lab copy', hint: "Your lab's own copy of a master case sheet." },
  local: { kind: 'local', label: 'Local', hint: 'A case sheet your lab made. It is not part of the masters.' },
};

export function statusOf(f: FormRow): SheetStatus {
  return f.published ? 'published' : 'draft';
}

export function statusLabel(f: FormRow): string {
  if (f.published) return f.draft ? 'Published · changes in draft' : 'Published';
  return f.draft?.state === 'in_review' ? 'In review' : 'Draft';
}

export function originFilterOf(f: FormRow): Exclude<SheetOriginFilter, 'all'> {
  return f.origin === 'master' ? 'master' : f.origin === 'override' ? 'copy' : 'local';
}

/** A short code for the department chip: its initials (ENT stays ENT), at most three letters. */
export function deptCode(name: string): string {
  const words = name.replace(/&/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

export interface DeptRailRow {
  key: string;
  name: string;
  code: string;
  count: number;
  /** The switch: shown to doctors on Prepare. */
  isActive: boolean;
}

/** The rail: every department with the number of case sheets in it (under the other filters), plus "Other" when needed. */
export function railRows(forms: FormRow[], departments: DepartmentRow[]): DeptRailRow[] {
  const known = new Set(departments.map((d) => d.key.toLowerCase()));
  const count = (key: string | null, isOther: boolean) =>
    forms.filter((f) => (isOther ? !known.has((f.departmentKey ?? '').toLowerCase()) : (f.departmentKey ?? '').toLowerCase() === (key ?? '').toLowerCase())).length;
  const rows: DeptRailRow[] = [...departments]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((d) => ({ key: d.key, name: d.name, code: deptCode(d.name), count: count(d.key, false), isActive: d.isActive !== false }));
  const other = count(null, true);
  if (other) rows.push({ key: 'other', name: 'Other', code: '', count: other, isActive: true });
  return rows;
}

export function inDept(f: FormRow, dept: string | null, departments: DepartmentRow[]): boolean {
  if (!dept) return true;
  if (dept === 'other') return !departments.some((d) => d.key.toLowerCase() === (f.departmentKey ?? '').toLowerCase());
  return (f.departmentKey ?? '').toLowerCase() === dept.toLowerCase();
}

export interface SheetFilters {
  query: string;
  dept: string | null;
  status: SheetStatusFilter;
  origin: SheetOriginFilter;
}

export function filterSheets(forms: FormRow[], departments: DepartmentRow[], q: SheetFilters): FormRow[] {
  const text = q.query.trim().toLowerCase();
  return forms.filter(
    (f) =>
      inDept(f, q.dept, departments) &&
      (q.status === 'all' || statusOf(f) === q.status) &&
      (q.origin === 'all' || originFilterOf(f) === q.origin) &&
      (!text || f.title.toLowerCase().includes(text) || (f.departmentName ?? '').toLowerCase().includes(text) || (f.specialty ?? '').toLowerCase().includes(text)),
  );
}

/** The Origin pill as a DOM node (the same global `pf-origin-badge` classes as Test Master's). */
export function originElement(origin: FormRow['origin'], newerMaster = false): HTMLElement {
  const w = ORIGIN_WORDS[origin];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;height:100%;min-width:0;';
  const pill = document.createElement('span');
  pill.className = `pf-origin-badge pf-origin-badge--${w.kind}`;
  pill.setAttribute('role', 'note');
  pill.title = w.hint;
  pill.innerHTML =
    '<svg class="pf-origin-badge__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    `<path d="${ORIGIN_ICON_PATHS[w.kind]}"/></svg>`;
  const t = document.createElement('span');
  t.textContent = w.label;
  pill.appendChild(t);
  wrap.appendChild(pill);
  if (newerMaster) {
    const dot = document.createElement('span');
    dot.title = 'The master has a newer published version';
    dot.setAttribute('aria-label', dot.title);
    dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#8b5cf6;flex:0 0 auto;';
    wrap.appendChild(dot);
  }
  return wrap;
}

export interface SheetGridContext {
  open(f: FormRow): void;
  edit(f: FormRow): void;
  menu(f: FormRow): void;
  pendingOf(f: FormRow): number;
  web: boolean;
}

const ICON = (path: string) =>
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  path +
  '</svg>';

function action(web: boolean, label: string, aria: string, path: string, run: () => void, icon = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pf-rowact' + (!web || icon ? ' pf-rowact--icon' : '') + (web && icon ? ' pf-tm-rowact-sm' : '');
  b.title = aria;
  b.setAttribute('aria-label', aria);
  b.innerHTML = ICON(path);
  const t = document.createElement('span');
  t.className = 'pf-rowact__t';
  t.textContent = label;
  b.appendChild(t);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    run();
  });
  return b;
}

export const sheetRowId = (p: { data: FormRow }): string => p.data.id;
export const sheetRowClass = (p: RowClassParams<FormRow>): string | undefined => (p.data?.status === 'archived' ? 'pf-tm-row--off' : undefined);

/** Name, Department, Origin, Version, Status, Pending, Updated, Edit — Test Master's columns for case sheets. */
export function sheetColumns(web: boolean, isPhone: boolean): ColDef<FormRow>[] {
  const cols: ColDef<FormRow>[] = [
    {
      headerName: 'Name', field: 'title', colId: 'name', width: 210, minWidth: 170, pinned: 'left', wrapText: true, autoHeight: true, tooltipField: 'title',
      cellClass: 'pf-tm-wrap',
      cellRenderer: (p: ICellRendererParams<FormRow>) => {
        // Test Master's wrapped-name cell: up to two lines, the row grows to fit, the tooltip keeps the full name.
        const wrap = document.createElement('div');
        wrap.className = 'pf-tm-wrapcell';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pf-tm-tree-name';
        b.style.cssText = 'background:none;border:0;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer;min-width:0;line-height:1.35;';
        const t = document.createElement('span');
        t.className = 'pf-tm-clamp2';
        t.textContent = p.data?.title ?? '';
        b.appendChild(t);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (p.data) (p.context as SheetGridContext).open(p.data);
        });
        wrap.appendChild(b);
        return wrap;
      },
    },
    { headerName: 'Department', colId: 'department', flex: 1.4, minWidth: 180, valueGetter: (p) => p.data?.departmentName ?? 'Other' },
    {
      headerName: 'Origin', colId: 'origin', flex: 1, minWidth: 110, maxWidth: 130, editable: false,
      valueGetter: (p) => (p.data ? ORIGIN_WORDS[p.data.origin].label : ''),
      cellRenderer: (p: ICellRendererParams<FormRow>) => (p.data ? originElement(p.data.origin, p.data.newerMaster) : document.createElement('span')),
    },
    { headerName: 'Version', colId: 'version', flex: 0.7, minWidth: 88, maxWidth: 96, valueGetter: (p) => (p.data?.published ? `v${p.data.published.versionNo}` : '—') },
    { headerName: 'Status', colId: 'status', flex: 1, minWidth: 96, valueGetter: (p) => (p.data ? statusLabel(p.data) : '') },
    {
      headerName: 'Pending', colId: 'pending', flex: 0.8, minWidth: 92, maxWidth: 98, type: 'numericColumn',
      valueGetter: (p) => (p.data ? (p.context as SheetGridContext).pendingOf(p.data) : 0),
      cellRenderer: (p: ICellRendererParams<FormRow>) => {
        const s = document.createElement('span');
        s.className = 'pf-num';
        s.textContent = p.value ? String(p.value) : '—';
        return s;
      },
    },
    {
      headerName: 'Updated', colId: 'updated', flex: 1, minWidth: 100,
      valueGetter: (p) => p.data?.draft?.updatedAt ?? p.data?.published?.publishedAt ?? '',
      valueFormatter: (p) => (p.value ? whenText(p.value as string) : '—'),
    },
    {
      headerName: '', colId: 'actions', cellClass: 'pf-tm-acts-cell', editable: false, sortable: false, filter: false, resizable: false, suppressSizeToFit: true,
      width: web ? 112 : 112, minWidth: 112, maxWidth: 112, pinned: 'right',
      cellRenderer: (p: ICellRendererParams<FormRow>) => {
        const wrap = document.createElement('div');
        wrap.className = 'pf-tm-acts';
        const d = p.data;
        if (!d) return wrap;
        const ctx = p.context as SheetGridContext;
        wrap.appendChild(action(web, 'Edit', 'Edit ' + d.title, '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', () => (d.origin === 'master' ? ctx.edit(d) : ctx.open(d))));
        if (d.origin !== 'master') wrap.appendChild(action(web, 'More', 'More for ' + d.title, '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', () => ctx.menu(d), true));
        return wrap;
      },
    },
  ];
  if (!isPhone) return cols;
  // Phone: Name (wraps, scrolls with the page, not pinned) + Origin + the row actions, so nothing is cut off sideways.
  return cols
    .filter((c) => ['name', 'origin', 'actions'].includes(String(c.colId ?? '')))
    .map((c) => (c.colId === 'name' ? { ...c, pinned: null, flex: 1, width: undefined, minWidth: 130 } : c.colId === 'origin' ? { ...c, flex: undefined, width: 104, minWidth: 104, maxWidth: 110 } : c));
}
