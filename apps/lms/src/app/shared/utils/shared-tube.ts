import type { OrderSample, OrderTest } from '../models/order.model';

/**
 * Shared tubes (owner 2026-09-27): ONE physical tube per tube type per draw,
 * whatever the department. A tube is one sample row holding every test drawn
 * into it — CBC (Haematology) and HbA1c (Biochemistry) share one EDTA, one
 * Sample ID, one label. The row's `department` is only the representative;
 * these helpers name every department on the tube (the server annotates
 * `departments`), falling back to the representative on older payloads.
 */

type TubeLike = Pick<OrderSample, 'department' | 'departments'>;

/** Department names on the tube, representative first, de-duplicated. */
export function tubeDepartmentNames(s: TubeLike | null | undefined): string[] {
  const list = (s?.departments ?? []).map(d => (d?.name ?? '').trim()).filter(Boolean);
  if (list.length === 0 && s?.department?.name) list.push(s.department.name.trim());
  return [...new Set(list)];
}

/** "Haematology · Biochemistry" — the card / list line for a tube. */
export function tubeDepartmentLabel(s: TubeLike | null | undefined, fallback = 'Sample'): string {
  const names = tubeDepartmentNames(s);
  return names.length ? names.join(' · ') : fallback;
}

/** "HEM/BIO" — the department code(s) printed on a label (upper-case). */
export function tubeDepartmentCodes(s: TubeLike | null | undefined): string {
  const codes = (s?.departments ?? []).map(d => (d?.code ?? '').trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) {
    const c = (s?.department?.code ?? '').trim().toUpperCase();
    return c;
  }
  return [...new Set(codes)].join('/');
}

/** True when the tube carries tests of more than one department. */
export function isSharedTube(s: TubeLike | null | undefined): boolean {
  return tubeDepartmentNames(s).length > 1;
}

/** The department a single LINE belongs to: on an in-house tube its own
 *  test's department (shared tubes span several), else the tube's. */
export function lineDepartment(
  t: Pick<OrderTest, 'test'> & { routingDepartment?: OrderTest['routingDepartment']; subOrder?: Partial<OrderSample> | null },
): { id: string | null; name: string | null } {
  // The server's resolved department wins (it maps reference-catalogue rows
  // into the tenant's own departments).
  if (t.routingDepartment?.id) return { id: t.routingDepartment.id, name: t.routingDepartment.name ?? null };
  const sub = t.subOrder;
  const test = t.test as { departmentId?: string | null; department?: { id?: string; name?: string } | null } | undefined;
  const inHouse = !sub?.outsourcedVendorId;
  if (inHouse && (test?.department?.name || test?.departmentId)) {
    return { id: test?.departmentId ?? test?.department?.id ?? null, name: test?.department?.name ?? null };
  }
  return { id: sub?.departmentId ?? test?.departmentId ?? null, name: sub?.department?.name ?? test?.department?.name ?? null };
}
